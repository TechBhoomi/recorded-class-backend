const fs = require('fs-extra');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const execPromise = promisify(exec);
const moment = require('moment');
const sequelize = require("../config/db"); 
const { connectSFTP, serverAConfig, recordServerConfig } = require('../helpers/video_downloads');
const DownloadVideos = require('../models/download_videos');
const { Op } = require('sequelize');
class InMemoryQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.keyMap = new Map(); // Track keys to avoid duplicates
    }

    async enqueue(key, task) {
        // Check if this task is already in the queue or being processed
        if (this.keyMap.has(key)) {
            // Return existing promise for this key
            return this.keyMap.get(key).promise;
        }
        
        // Create a new promise for this task
        const promiseData = {};
        const promise = new Promise((resolve, reject) => {
            promiseData.resolve = resolve;
            promiseData.reject = reject;
        });
        
        // Store the promise and resolvers
        promiseData.promise = promise;
        this.keyMap.set(key, promiseData);
        
        // Add to queue
        this.queue.push({ key, task });
        
        // Start processing if not already in progress
        if (!this.processing) {
            this.processQueue();
        }
        
        return promise;
    }

    async processQueue() {
        if (this.processing) return;
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            const { key, task } = this.queue.shift();
            
            try {
                const result = await task();
                
                // Resolve the promise for this task
                const promiseData = this.keyMap.get(key);
                if (promiseData && promiseData.resolve) {
                    promiseData.resolve(result);
                }
            } catch (error) {
                console.error(`Error processing task ${key}:`, error);
                
                // Reject the promise for this task
                const promiseData = this.keyMap.get(key);
                if (promiseData && promiseData.reject) {
                    promiseData.reject(error);
                }
            } finally {
                // Remove the key from the map after processing
                this.keyMap.delete(key);
            }
        }
        
        this.processing = false;
    }
}

// Create a singleton instance for DB locks across the application
const dbLockManager = (() => {
    const locks = new Map();
    
    return {
        acquireLock: async (lockKey, timeoutMs = 10000) => {
            const startTime = Date.now();
            
            while (locks.has(lockKey)) {
                if (Date.now() - startTime > timeoutMs) {
                    throw new Error(`Timeout waiting for lock: ${lockKey}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            locks.set(lockKey, true);
            return true;
        },
        
        releaseLock: (lockKey) => {
            locks.delete(lockKey);
            return true;
        }
    };
})();

class EnhancedVideoFileManager {
    constructor(remoteDir, localDir,recordDir) {
        this.remoteDir = remoteDir;
        this.localDir = localDir;
        this.recordDir = recordDir;
        this.activeDownloads = new Map();
        this.fileDownloadLocks = new Map();
        this.downloadPromises = new Map();
        this.downloadQueue = new InMemoryQueue();
    }

    async getVideoDuration(filePath) {
        try {
            const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
            const { stdout } = await execPromise(cmd);
            const durationInSeconds = parseFloat(stdout);
            const hours = Math.floor(durationInSeconds / 3600);
            const minutes = Math.floor((durationInSeconds % 3600) / 60);
            const seconds = Math.round(durationInSeconds % 60);
            
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } catch (error) {
            console.error(`Error getting video duration: ${error.message}`);
            return '00:00:00';
        }
    }

    getFileSize(file) {
        if (file.attrs && typeof file.attrs.size !== 'undefined') {
            return file.attrs.size;
        } else if (typeof file.size !== 'undefined') {
            return file.size;
        } else {
            console.warn(`Size not found for file ${file.name}, using default`);
            return 1000; 
        }
    }
    async checkFilesExistRemotelyMain(batchName, date) {
        // Implementation unchanged
        let sftpA = null;
        try {
            const batchRemoteDir = path.join(String(this.recordDir), String(batchName));
            sftpA = await connectSFTP(recordServerConfig, "Server A");

            console.log(`Checking remote directory: ${batchRemoteDir}`);

            try {
                const dirExists = await sftpA.exists(batchRemoteDir);
                if (!dirExists) {
                    console.error(`Remote directory ${batchRemoteDir} does not exist`);
                    return { exists: false, files: [] };
                }
            } catch (dirError) {
                console.error(`Error checking if directory exists: ${batchRemoteDir}`, dirError);
                return { exists: false, files: [] };
            }

            const files = await sftpA.list(batchRemoteDir);
            console.log(`Found ${files.length} files in remote directory`);

            const dateFiles = files.filter(file => {
                const matches = file.name.includes(date) &&
                    (file.name.endsWith('.webm') || file.name.endsWith('.mp4'));

                if (matches) {
                    console.log(`Found matching file: ${file.name}`);
                }
                return matches;
            });

            console.log(`Found ${dateFiles.length} files matching date ${date}`);
            return {
                exists: dateFiles.length > 0,
                files: dateFiles
            };
        } catch (error) {
            console.error(`Error checking remote files for date ${date}:`, error);
            return {
                exists: false,
                files: []
            };
        } finally {
            if (sftpA) {
                await sftpA.end();
            }
        }
    }
    async checkFilesExistRemotely(batchName, date) {
        // Implementation unchanged
        let sftpA = null;
        try {
            const batchRemoteDir = path.join(String(this.remoteDir), String(batchName));
            sftpA = await connectSFTP(serverAConfig, "Server A");

            console.log(`Checking remote directory: ${batchRemoteDir}`);

            try {
                const dirExists = await sftpA.exists(batchRemoteDir);
                if (!dirExists) {
                    console.error(`Remote directory ${batchRemoteDir} does not exist`);
                    return { exists: false, files: [] };
                }
            } catch (dirError) {
                console.error(`Error checking if directory exists: ${batchRemoteDir}`, dirError);
                return { exists: false, files: [] };
            }

            const files = await sftpA.list(batchRemoteDir);
            console.log(`Found ${files.length} files in remote directory`);

            const dateFiles = files.filter(file => {
                const matches = file.name.includes(date) &&
                    (file.name.endsWith('.webm') || file.name.endsWith('.mp4'));

                if (matches) {
                    console.log(`Found matching file: ${file.name}`);
                }
                return matches;
            });

            console.log(`Found ${dateFiles.length} files matching date ${date}`);
            return {
                exists: dateFiles.length > 0,
                files: dateFiles
            };
        } catch (error) {
            console.error(`Error checking remote files for date ${date}:`, error);
            return {
                exists: false,
                files: []
            };
        } finally {
            if (sftpA) {
                await sftpA.end();
            }
        }
    }

    async downloadVideoForStudent(student_id, batchName, dates) {
        if (!Array.isArray(dates)) {
            dates = [dates];
        }
    
        const results = [];
        const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; 
    
        for (const date of dates) {
            try {
                const requestedDate = new Date(date);
                const formattedDate = requestedDate.toISOString().split('T')[0] + ' 00:00:00+00';
                console.log(formattedDate);
    
                const recordKey = `${student_id}_${batchName}_${date}`;
                
                // Use our queue system
                const result = await this.downloadQueue.enqueue(recordKey, async () => {
                    // Acquire a database lock for this specific combination
                    const dbLockKey = `db_lock_${recordKey}`;
                    await dbLockManager.acquireLock(dbLockKey);
                    
                    try {
                        // Use a transaction to prevent race conditions at the database level
                        return await sequelize.transaction(async (t) => {
                            let downloadRecord;
                        
                            // Find existing record - now with transaction
                            const existingRecord = await DownloadVideos.findOne({
                                where: {
                                    student_id,
                                    batch_name: batchName,
                                    requested_date: formattedDate,
                                    delete_status: false,
                                    download_status: { [Op.ne]: 'failed' } 
                                },
                                transaction: t,
                                lock: t.LOCK.UPDATE // Use row-level locking
                            });
                            
                            if (existingRecord) {
                                console.log(`Found existing active record ${existingRecord.id} for ${recordKey}`);
                
                                if (existingRecord.download_status === 'in_progress' || existingRecord.download_status === 'pending') {
                                    let fileDetails = existingRecord.file_details || [];
                                    let hasStuckFiles = false;
                                    const currentTime = new Date().getTime();
                
                                    fileDetails = fileDetails.map(file => {
                                        if (file.status === 'downloading') {
                                            const downloadStartTime = file.download_start ? new Date(file.download_start).getTime() : 0;
                
                                            if (downloadStartTime > 0 && (currentTime - downloadStartTime) > DOWNLOAD_TIMEOUT_MS) {
                                                console.log(`Resetting stuck download for file ${file.name} - stuck for ${(currentTime - downloadStartTime) / 60000} minutes`);
                                                hasStuckFiles = true;
                                                return {
                                                    ...file,
                                                    status: 'pending',
                                                    download_start: null,
                                                    error: file.error ? `Previous attempt timed out: ${file.error}` : 'Previous download attempt timed out'
                                                };
                                            }
                                        }
                                        return file;
                                    });
                
                                    if (hasStuckFiles) {
                                        await existingRecord.update({
                                            file_details: fileDetails,
                                            details: {
                                                ...existingRecord.details,
                                                stuck_files_reset_at: new Date()
                                            }
                                        }, { transaction: t });
                                        console.log(`Reset stuck downloads for record ${existingRecord.id}`);
                                    }
                                }
                
                                downloadRecord = existingRecord;
                            } else {
                                // Create new record if none exists - now with transaction
                                downloadRecord = await DownloadVideos.create({
                                    student_id,
                                    type: 'video',
                                    batch_name: batchName,
                                    requested_date: date,
                                    download_status: 'pending',
                                    delete_status: false,
                                    active_upto: moment().add(7, 'days').toDate(),
                                    file_details: [],
                                    details: {}
                                }, { transaction: t });
                                console.log(`Created new record ${downloadRecord.id} for ${recordKey}`);
                            }
                
                            if (downloadRecord.download_status === 'completed') {
                                return {
                                    date,
                                    status: 'already_downloaded',
                                    record_id: downloadRecord.id,
                                    files: downloadRecord.file_details
                                };
                            }
                
                            // Rest of the implementation remains largely the same
                            const remoteCheck = await this.checkFilesExistRemotely(batchName, date);
                            const remoteMainCheck = await this.checkFilesExistRemotelyMain(batchName, date);
                            if (!remoteCheck.exists && !remoteMainCheck) {
                                await downloadRecord.update({
                                    download_status: 'failed',
                                    details: {
                                        error: 'No videos found for this date',
                                        checked_at: new Date()
                                    }
                                }, { transaction: t });
                
                                return {
                                    date,
                                    status: 'failed',
                                    error: 'No videos found',
                                    record_id: downloadRecord.id
                                };
                            }
                
                            // Process file_details
                            let fileDetails = downloadRecord.file_details || [];
                            fileDetails = JSON.parse(JSON.stringify(fileDetails));
                
                            const existingFiles = new Set(fileDetails.map(f => f.name));
                            const newFiles = remoteCheck.files.filter(file => !existingFiles.has(file.name));
                            const newFiles2 = remoteMainCheck.files.filter(file => !existingFiles.has(file.name));
                            console.log(newFiles,newFiles2,"sddasfffff");
                            if (newFiles.length > 0) {
                                // Check if files exist locally before adding to pending queue
                                const batchLocalDir = path.join(String(this.localDir), String(batchName));
                                
                                for (const file of newFiles) {
                                    const localFilePath = path.join(batchLocalDir, file.name);
                                    
                                    // Check if file already exists locally
                                    let fileExists = false;
                                    try {
                                        const stats = await fs.promises.stat(localFilePath);
                                        // If file exists with similar size, consider it downloaded
                                        if (stats.size > 0 && Math.abs(stats.size - this.getFileSize(file)) < 1024) {
                                            fileExists = true;
                                            console.log(`File ${file.name} already exists locally with correct size`);
                                            
                                            // Get video duration if it's a video file
                                            let duration = "00:00:00";
                                            if (file.name.endsWith('.webm') || file.name.endsWith('.mp4')) {
                                                try {
                                                    duration = await this.getVideoDuration(localFilePath);
                                                } catch (err) {
                                                    console.warn(`Failed to get duration for ${file.name}: ${err.message}`);
                                                }
                                            }
                                            
                                            // Add it as already completed
                                            fileDetails.push({
                                                name: file.name,
                                                size: stats.size,
                                                status: 'completed',
                                                download_start: new Date(),
                                                download_end: new Date(),
                                                error: null,
                                                duration: duration
                                            });
                                        }
                                    } catch (err) {
                                        // File doesn't exist, will be added to download queue
                                        fileExists = false;
                                    }
                                    
                                    // Only add to pending if file doesn't exist locally
                                    if (!fileExists) {
                                        fileDetails.push({
                                            name: file.name,
                                            size: this.getFileSize(file),
                                            status: 'pending',
                                            download_start: null,
                                            download_end: null,
                                            error: null
                                        });
                                    }
                                }
                            }else if (newFiles2.length > 0) {
                                // Check if files exist locally before adding to pending queue
                                const batchLocalDir = path.join(String(this.localDir), String(batchName));
                                
                                for (const file of newFiles2) {
                                    const localFilePath = path.join(batchLocalDir, file.name);
                                    
                                    // Check if file already exists locally
                                    let fileExists = false;
                                    try {
                                        const stats = await fs.promises.stat(localFilePath);
                                        // If file exists with similar size, consider it downloaded
                                        if (stats.size > 0 && Math.abs(stats.size - this.getFileSize(file)) < 1024) {
                                            fileExists = true;
                                            console.log(`File ${file.name} already exists locally with correct size`);
                                            
                                            // Get video duration if it's a video file
                                            let duration = "00:00:00";
                                            if (file.name.endsWith('.webm') || file.name.endsWith('.mp4')) {
                                                try {
                                                    duration = await this.getVideoDuration(localFilePath);
                                                } catch (err) {
                                                    console.warn(`Failed to get duration for ${file.name}: ${err.message}`);
                                                }
                                            }
                                            
                                            // Add it as already completed
                                             fileDetails.push({
                                                name: file.name,
                                                size: stats.size,
                                                status: 'completed',
                                                download_start: new Date(),
                                                download_end: new Date(),
                                                error: null,
                                                duration: duration
                                            });
                                        }
                                    } catch (err) {
                                        // File doesn't exist, will be added to download queue
                                        fileExists = false;
                                    }
                                    console.log(fileExists,"fileExists");
                                    
                                    // Only add to pending if file doesn't exist locally
                                    if (!fileExists) {
                                        fileDetails.push({
                                            name: file.name,
                                            size: this.getFileSize(file),
                                            status: 'pending',
                                            download_start: null,
                                            download_end: null,
                                            error: null
                                        });
                                    }
                                }
                            }
                            const hasPendingFiles = fileDetails.some(file => file.status === 'pending');
                            const allFilesComplete = fileDetails.every(file => file.status === 'completed');
                            if (allFilesComplete) {
                                await downloadRecord.update({
                                    download_status: 'completed',
                                    file_details: fileDetails
                                }, { transaction: t });
                                
                                console.log(`All files completed for record ${downloadRecord.id}`);
                                
                                return {
                                    date,
                                    status: 'completed',
                                    record_id: downloadRecord.id,
                                    files: fileDetails
                                };
                            }else if (newFiles.length > 0 || newFiles2.length > 0 || hasPendingFiles) {
                                // Keep existing logic for in-progress status
                                await downloadRecord.update({
                                    download_status: 'in_progress',
                                    file_details: fileDetails
                                }, { transaction: t });
                            
                                console.log(`Updated record status to in_progress with ${fileDetails.length} files`);
                            }
                            // Update the record with new file details if needed
                            
                
                            // if (newFiles.length > 0 || newFiles2.length > 0 || hasPendingFiles) {
                            //     await downloadRecord.update({
                            //         download_status: 'in_progress',
                            //         file_details: fileDetails
                            //     }, { transaction: t });
                
                            //     console.log(`Updated record status to in_progress with ${fileDetails.length} files`);
                            // }
                
                            const pendingFiles = fileDetails.filter(f => f.status === 'pending');
                
                            // Schedule background process
                            if (pendingFiles.length > 0) {
                                console.log(`Starting download process for ${pendingFiles.length} pending files`);
                                // Use a separate function to avoid waiting for the entire process
                                // Start this AFTER the transaction completes
                                let server 
                                if(newFiles.length > 0){
                                    server = 'ServerA'
                                }else if(newFiles2.length > 0){
                                    server = 'ServerMain'
                                }
                                setImmediate(() => {
                                    this.processDownload(downloadRecord.id, batchName, date, fileDetails, recordKey,server)
                                        .catch(err => {
                                            console.error(`Error in background download process for ${recordKey}:`, err);
                                        });
                                });
                            } else {
                                // Update overall status - this can be done outside the transaction
                                setImmediate(() => {
                                    this.updateOverallStatus(downloadRecord.id)
                                        .catch(err => {
                                            console.error(`Error updating status for ${recordKey}:`, err);
                                        });
                                });
                                console.log(`No pending files to download, scheduled status update for record ${downloadRecord.id}`);
                            }
                            return {
                                date,
                                status: 'download_started',
                                record_id: downloadRecord.id,
                                file_count: fileDetails.length,
                                new_files: newFiles.length,
                                pending_files: fileDetails.filter(f => f.status === 'pending').length,
                                local_files: fileDetails.filter(f => f.status === 'completed').length
                            };
                        });
                    } finally {
                        // Always release the lock
                        dbLockManager.releaseLock(dbLockKey);
                    }
                });
                
                results.push(result);
            } catch (error) {
                console.error(`Error initiating download for date ${date}:`, error);
                results.push({
                    date,
                    status: 'error',
                    error: error.message
                });
            }
        }
        
        return results;
    }

    async processDownload(recordId, batchName, date, fileDetails, recordKey, server) {
        try {
            console.log(`Starting background download process for record ${recordId}`);
            const pendingFiles = fileDetails.filter(f => f.status === 'pending');
            
            if (pendingFiles.length === 0) {
                console.log(`No pending files found for record ${recordId}`);
                await this.updateOverallStatus(recordId);
                return;
            }
            
            const localDirStr = String(this.localDir);
            const batchNameStr = String(batchName);
            const studentDownloadDir = path.join(localDirStr, batchNameStr);
            
            // Make sure directory exists
            await fs.promises.mkdir(studentDownloadDir, { recursive: true });
            let serverConfig 
            // if( server == 'ServerA'){
            //     serverConfig = serverAConfig 
            //     this.remoteDir
            // }else 
            if (server == 'ServerMain'){
                this.remoteDir = this.recordDir
                serverConfig = recordServerConfig
            }else{
                serverConfig = serverAConfig 
                this.remoteDir
            }
            // Establish SFTP connection
            const sftpA = await connectSFTP(serverConfig, "Server A");
            const batchRemoteDir = path.join(String(this.remoteDir), String(batchName));
            
            try {
                // Process each pending file sequentially
                for (const file of pendingFiles) {
                    const fileKey = `${recordKey}_${file.name}`;
                    
                    // Skip if already being downloaded
                    if (this.fileDownloadLocks.has(fileKey)) {
                        console.log(`File ${file.name} is already being downloaded, skipping`);
                        continue;
                    }
                    
                    this.fileDownloadLocks.set(fileKey, true);
                    
                    try {
                        const localFilePath = path.join(studentDownloadDir, file.name);
                        const remoteFilePath = path.join(batchRemoteDir, file.name);
                        
                        // Update file status to downloading
                        await this.updateFileStatus(recordId, file.name, {
                            status: 'downloading',
                            download_start: new Date()
                        });
                        
                        console.log(`Downloading file ${file.name} from ${remoteFilePath} to ${localFilePath}`);
                        
                        // Download the file
                        await sftpA.fastGet(remoteFilePath, localFilePath);
                        
                        // Get video duration if it's a video file
                        let duration = "00:00:00";
                        if (file.name.endsWith('.webm') || file.name.endsWith('.mp4')) {
                            try {
                                duration = await this.getVideoDuration(localFilePath);
                            } catch (durationErr) {
                                console.warn(`Failed to get duration for ${file.name}: ${durationErr.message}`);
                            }
                        }
                        
                        // Get file size
                        const stats = await fs.promises.stat(localFilePath);
                        
                        // Update file status to completed
                        await this.updateFileStatus(recordId, file.name, {
                            status: 'completed',
                            download_end: new Date(),
                            size: stats.size,
                            duration: duration
                        });
                        
                        console.log(`Successfully downloaded file ${file.name}`);
                    } catch (fileError) {
                        console.error(`Error downloading file ${file.name}:`, fileError);
                        
                        // Update file status to failed
                        await this.updateFileStatus(recordId, file.name, {
                            status: 'failed',
                            error: fileError.message
                        });
                    } finally {
                        this.fileDownloadLocks.delete(fileKey);
                    }
                }
            } finally {
                // Close SFTP connection
                await sftpA.end();
            }
            
            // Update overall status
            await this.updateOverallStatus(recordId);
        } catch (error) {
            console.error(`Error in download process for record ${recordId}:`, error);
            
            // Update record status to failed
            await DownloadVideos.update({
                download_status: 'failed',
                details: {
                    error: error.message,
                    failed_at: new Date()
                }
            }, {
                where: { id: recordId }
            });
        }
    }
    
    async updateFileStatus(recordId, fileName, updates) {
        // Use a transaction for this update to prevent race conditions
        return await sequelize.transaction(async (t) => {
            const record = await DownloadVideos.findByPk(recordId, { 
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            
            if (!record) {
                throw new Error(`Record ${recordId} not found`);
            }
            
            let fileDetails = record.file_details || [];
            fileDetails = JSON.parse(JSON.stringify(fileDetails));
            
            const fileIndex = fileDetails.findIndex(f => f.name === fileName);
            if (fileIndex === -1) {
                throw new Error(`File ${fileName} not found in record ${recordId}`);
            }
            
            fileDetails[fileIndex] = {
                ...fileDetails[fileIndex],
                ...updates
            };
            
            await record.update({ file_details: fileDetails }, { transaction: t });
            return fileDetails;
        });
    }
    
    async updateOverallStatus(recordId) {
        return await sequelize.transaction(async (t) => {
            const record = await DownloadVideos.findByPk(recordId, {
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            
            if (!record) {
                throw new Error(`Record ${recordId} not found`);
            }
            
            const fileDetails = record.file_details || [];
            
            const completedFiles = fileDetails.filter(f => f.status === 'completed');
            const failedFiles = fileDetails.filter(f => f.status === 'failed');
            const pendingFiles = fileDetails.filter(f => f.status === 'pending');
            const downloadingFiles = fileDetails.filter(f => f.status === 'downloading');
            
            console.log(`Record ${recordId} status check: completed=${completedFiles.length}, failed=${failedFiles.length}, pending=${pendingFiles.length}, downloading=${downloadingFiles.length}`);
            
            let newStatus = 'in_progress';
            
            if (fileDetails.length === 0) {
                newStatus = 'failed';
            } else if (pendingFiles.length === 0 && downloadingFiles.length === 0) {
                if (completedFiles.length > 0) {
                    newStatus = 'completed';
                } else {
                    newStatus = 'failed';
                }
            } else {
                newStatus = 'in_progress';
            }
            
            console.log(`Setting record ${recordId} status to ${newStatus}`);
          
            await record.update({
                download_status: newStatus,
                details: {
                    ...record.details,
                    updated_at: new Date(),
                    success_count: completedFiles.length,
                    failed_count: failedFiles.length,
                    pending_count: pendingFiles.length,
                    downloading_count: downloadingFiles.length,
                    total_count: fileDetails.length
                }
            }, { transaction: t });
            
            console.log(`Updated record ${recordId} status to ${newStatus}`);
            return newStatus;
        });
    }
}


const getVideoFilesRoute = async (req, res) => {
    try {
        const { student_id, batch_name, date } = req.body;
        if (!student_id || !batch_name || !date) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: student_id, batch_name, and date are required'
            });
        }
        
        const videoManager = new EnhancedVideoFileManager(
            "/home/techreactive/var/www/html/videos",
            "/home/recorded-class-backend/public/videos/downloaded_videos/",
            "/var/www/html/node_recorder/videos/",
        );
        
        const result = await videoManager.downloadVideoForStudent(student_id, batch_name, date);
        res.json(result);
    } catch (error) {
        console.error('Error in downloadVideosRoute:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

const getDownloadStatusRoute = async (req, res) => {
    try {
        const { student_id, batch_name, date } = req.query;
        if (!student_id || !batch_name || !date) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: student_id, batch_name, and date are required'
            });
        }
        
        const videoManager = new EnhancedVideoFileManager(
            "/home/techreactive/var/www/html/videos/",
            "/home/recorded-class-backend/public/videos/downloaded_videos/",
            "/var/www/html/node_recorder/videos/",
        );
        
        const result = await videoManager.getDownloadStatus(student_id, batch_name, date);
        res.json(result);
    } catch (error) {
        console.error('Error in getDownloadStatusRoute:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

module.exports = {
    EnhancedVideoFileManager,
    getVideoFilesRoute,
    getDownloadStatusRoute,
};