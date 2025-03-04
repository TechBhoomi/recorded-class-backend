const fs = require('fs-extra');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const execPromise = promisify(exec);
const moment = require('moment');
const sequelize = require("../config/db"); // Adjust the path as necessary
// Import your existing SFTP connection helper
const { connectSFTP, serverAConfig } = require('../helpers/video_downloads');
// Import the DownloadVideos model
const DownloadVideos = require('../models/download_videos');
class EnhancedVideoFileManager {
    constructor(remoteDir, localDir) {
        this.remoteDir = remoteDir;
        this.localDir = localDir;
        this.activeDownloads = new Map();
        // Add a file lock map to track which files are currently being downloaded
        this.fileDownloadLocks = new Map();
        // Add a new map to track download promises
        this.downloadPromises = new Map();
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
    // Safe size getter handles different SFTP server formats
    getFileSize(file) {
        // Different SFTP servers might store size in different properties
        if (file.attrs && typeof file.attrs.size !== 'undefined') {
            return file.attrs.size;
        } else if (typeof file.size !== 'undefined') {
            return file.size;
        } else {
            console.warn(`Size not found for file ${file.name}, using default`);
            return 1000; // 1 KB default
        }
    }
    async checkFilesExistRemotely(batchName, date) {
        let sftpA = null;
        try {
            const batchRemoteDir = path.join(String(this.remoteDir), String(batchName));
            sftpA = await connectSFTP(serverAConfig, "Server A");
    
            console.log(`Checking remote directory: ${batchRemoteDir}`);
            
            // Check if directory exists first
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
    
            // Log first file to debug its structure
            if (files && files.length > 0) {
                console.log('First file structure:', JSON.stringify(files[0]));
            }
    
            // Filter files for the specific date with more detailed logging
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
    const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes threshold for stuck downloads

    for (const date of dates) {
        try {
            // Create a unique key for the concurrent request protection
            const recordKey = `${student_id}_${batchName}_${date}`;
            
            // If there's already a download promise for this key, wait for it
            if (this.downloadPromises.has(recordKey)) {
                console.log(`Concurrent request detected for ${recordKey}, waiting for existing operation to complete`);
                try {
                    await this.downloadPromises.get(recordKey);
                } catch (err) {
                    console.error(`Error waiting for existing promise for ${recordKey}:`, err);
                    // Continue with the process even if the previous promise failed
                }
            }
            
            // Create a new promise for this operation
            const downloadPromise = (async () => {
                let downloadRecord;
                
                // Using a transaction to ensure data consistency
                const result = await sequelize.transaction(async (t) => {
                    // First check if any active record exists with this criteria
                    // that is either pending or in progress (not completed or failed)
                    const existingRecord = await DownloadVideos.findOne({
                        where: {
                            student_id,
                            batch_name: batchName,
                            requested_date: date,
                            delete_status: false,
                            download_status: ['pending', 'in_progress'] // Only consider pending or in_progress records
                        },
                        lock: true, // This translates to FOR UPDATE
                        transaction: t
                    });
                    
                    // Log if a record was found for debugging
                    if (existingRecord) {
                        console.log(`Found existing active record ${existingRecord.id} for ${recordKey}`);
                        
                        // Check for stuck downloads
                        if (existingRecord.download_status === 'in_progress' || existingRecord.download_status === 'pending') {
                            console.log("hhhhhhhhhhhhhhhh");

                            let fileDetails = existingRecord.file_details || [];
                            let hasStuckFiles = false;
                            const currentTime = new Date().getTime();
                
                            // Reset downloads that have been stuck for over 30 minutes
                            fileDetails = fileDetails.map(file => {
                                if (file.status === 'downloading') {
                                    const downloadStartTime = file.download_start ? new Date(file.download_start).getTime() : 0;
                                    console.log(downloadStartTime,currentTime - downloadStartTime, DOWNLOAD_TIMEOUT_MS,"hhhhhhhhhhffffffffff");

                                    if (downloadStartTime > 0 && (currentTime - downloadStartTime) > DOWNLOAD_TIMEOUT_MS) {
                                        console.log(`Resetting stuck download for file ${file.name} - stuck for ${(currentTime - downloadStartTime)/60000} minutes`);
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
                
                            // Update the record if we found and reset stuck files
                            if (hasStuckFiles) {
                                console.log("kkkkkkkkkkkkkkkkkkkkkkk");
                
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
                        // Check if we have a completed or failed record that is not deleted
                        const existingCompletedRecord = await DownloadVideos.findOne({
                            where: {
                                student_id,
                                batch_name: batchName,
                                requested_date: date,
                                delete_status: false,
                                download_status: ['completed', 'failed']
                            },
                            lock: true,
                            transaction: t
                        });
                        
                        if (existingCompletedRecord) {
                            // Reuse the completed/failed record and reset it if needed
                            downloadRecord = existingCompletedRecord;
                            console.log(`Reusing existing ${downloadRecord.download_status} record ${downloadRecord.id}`);
                            
                            // Reset the record status to pending for a retry
                            if (downloadRecord.download_status === 'failed' ) {
                                // Reset file statuses to pending for failed files
                                let fileDetails = downloadRecord.file_details || [];
                                fileDetails = fileDetails.map(file => {
                                    if (file.status === 'failed') {
                                        return {
                                            ...file,
                                            status: 'pending',
                                            download_start: null,
                                            download_end: null,
                                            error: null
                                        };
                                    }
                                    return file;
                                });
                                
                                await downloadRecord.update({
                                    download_status: 'pending',
                                    file_details: fileDetails,
                                    details: {
                                        ...downloadRecord.details,
                                        retry_at: new Date()
                                    }
                                }, { transaction: t });
                                
                                console.log(`Reset failed/partial record ${downloadRecord.id} to pending for retry`);
                            }
                        } else {
                            // Check for deleted records that can be reactivated
                            // const deletedRecord = await DownloadVideos.findOne({
                            //     where: {
                            //         student_id,
                            //         batch_name: batchName,
                            //         requested_date: date,
                            //         delete_status: true,
                            //         download_status: ['completed', 'failed']
                            //     },
                            //     lock: true,
                            //     transaction: t
                            // });
                            
                            // if (deletedRecord) {
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
                                // Reactivate the deleted record
                                // downloadRecord = deletedRecord;
                                // await downloadRecord.update({
                                //     delete_status: false,
                                //     download_status: 'pending',
                                //     active_upto: moment().add(7, 'days').toDate(),
                                //     file_details: [],
                                //     details: {
                                //         reactivated_at: new Date()
                                //     }
                                // }, { transaction: t });
                                
                                console.log(`new row for deleted record ${downloadRecord.id} for ${recordKey}`);
                            // } else {
                                // No record exists at all, create a new one
                                // downloadRecord = await DownloadVideos.create({
                                //     student_id,
                                //     type: 'video',
                                //     batch_name: batchName,
                                //     requested_date: date,
                                //     download_status: 'pending',
                                //     delete_status: false,
                                //     active_upto: moment().add(7, 'days').toDate(),
                                //     file_details: [],
                                //     details: {}
                                // }, { transaction: t });
                                
                                // console.log(`Created new download record  for ${recordKey}`);
                            // }
                        }
                    }
                    
                    return downloadRecord;
                });

                // Continue with the process outside the transaction
                downloadRecord = result;

                // If already completed, just return the record
                if (downloadRecord.download_status === 'completed') {
                    results.push({
                        date,
                        status: 'already_downloaded',
                        record_id: downloadRecord.id,
                        files: downloadRecord.file_details
                    });
                    return; // Exit the promise function
                }

                // Check if files exist remotely
                const remoteCheck = await this.checkFilesExistRemotely(batchName, date);

                if (!remoteCheck.exists) {
                    await downloadRecord.update({
                        download_status: 'failed',
                        details: {
                            error: 'No videos found for this date',
                            checked_at: new Date()
                        }
                    });

                    results.push({
                        date,
                        status: 'failed',
                        error: 'No videos found',
                        record_id: downloadRecord.id
                    });
                    return; // Exit the promise function
                }

                // Process file_details
                let fileDetails = downloadRecord.file_details || [];
                fileDetails = JSON.parse(JSON.stringify(fileDetails));
                
                const existingFiles = new Set(fileDetails.map(f => f.name));
                const newFiles = remoteCheck.files.filter(file => !existingFiles.has(file.name));

                if (newFiles.length > 0) {
                    // Add new files to file_details
                    newFiles.forEach(file => {
                        fileDetails.push({
                            name: file.name,
                            size: this.getFileSize(file),
                            status: 'pending',
                            download_start: null,
                            download_end: null,
                            error: null
                        });
                    });
                }

                // Update the record with new file details if needed
                const hasPendingFiles = fileDetails.some(file => file.status === 'pending');

                if (newFiles.length > 0 || hasPendingFiles) {
                    await downloadRecord.update({
                        download_status: 'in_progress',
                        file_details: fileDetails
                    });
                    
                    console.log(`Updated record status to in_progress with ${fileDetails.length} files`);
                }

                // Start async download process
                const downloadKey = `${student_id}_${batchName}_${date}`;

                if (!this.activeDownloads.has(downloadKey)) {
                    this.activeDownloads.set(downloadKey, true);

                    const pendingFiles = fileDetails.filter(f => f.status === 'pending');

                    if (pendingFiles.length > 0) {
                        console.log(`Starting download process for ${pendingFiles.length} pending files`);
                        this.processDownload(downloadRecord.id, batchName, date, fileDetails, downloadKey)
                            .catch(err => {
                                console.error(`Error in background download process for ${downloadKey}:`, err);
                                this.activeDownloads.delete(downloadKey);
                            });
                    } else {
                        await this.updateOverallStatus(downloadRecord.id);
                        this.activeDownloads.delete(downloadKey);
                        console.log(`No pending files to download, updated status for record ${downloadRecord.id}`);
                    }
                } else {
                    console.log(`Download process already active for key ${downloadKey}`);
                }

                results.push({
                    date,
                    status: 'download_started',
                    record_id: downloadRecord.id,
                    file_count: fileDetails.length,
                    new_files: newFiles.length,
                    pending_files: fileDetails.filter(f => f.status === 'pending').length
                });
            })();
            
            // Store the promise in the map and clean it up when done
            this.downloadPromises.set(recordKey, downloadPromise);
            
            try {
                await downloadPromise;
            } finally {
                // Clean up the promise reference
                if (this.downloadPromises.get(recordKey) === downloadPromise) {
                    this.downloadPromises.delete(recordKey);
                }
            }
        } catch (error) {
            console.error(`Error initiating download for date ${date}:`, error);
            results.push({
                date,
                status: 'error',
                error: error.message
            });
        }
    }

    return {
        success: true,
        student_id,
        batch_name: batchName,
        results
    };
}
    // Update status for all matching records that have this file
    async updateAllRecordsWithFile(batchName, fileName, fileStatus, duration = null, fileSize = null) {
        try {
            console.log(`Updating all records with file ${fileName} to status ${fileStatus}`);
            
            // Find all records with this batch and file name that are not deleted
            const records = await DownloadVideos.findAll({
                where: {
                    batch_name: batchName,
                    delete_status: false
                }
            });
            console.log(`Found ${records.length} records for batch ${batchName}`);
            for (const record of records) {
                let updated = false;
                // Make sure file_details is an array
                const fileDetails = Array.isArray(record.file_details) ? 
                    JSON.parse(JSON.stringify(record.file_details)) : [];
                // Find this file in the record's file_details
                for (let i = 0; i < fileDetails.length; i++) {
                    if (fileDetails[i].name === fileName) {
                        console.log(`Updating file ${fileName} in record ${record.id} from status ${fileDetails[i].status} to ${fileStatus}`);
                        
                        // Update the file status
                        fileDetails[i].status = fileStatus;
                        // Update timestamp based on status
                        if (fileStatus === 'completed') {
                            fileDetails[i].download_end = new Date();
                            if (!fileDetails[i].download_start) {
                                fileDetails[i].download_start = new Date();
                            }
                            if (duration) fileDetails[i].duration = duration;
                            if (fileSize) fileDetails[i].size = fileSize;
                        } else if (fileStatus === 'failed') {
                            fileDetails[i].download_end = new Date();
                        } else if (fileStatus === 'downloading' && !fileDetails[i].download_start) {
                            fileDetails[i].download_start = new Date();
                        }
                        updated = true;
                    }
                }
                if (updated) {
                    // Update the record with the modified file_details
                    try {
                        await record.update({ file_details: fileDetails });
                        console.log(`Updated file_details for record ${record.id}`);
                        
                        // Update the overall status of this record
                        await this.updateOverallStatus(record.id);
                    } catch (updateError) {
                        console.error(`Error updating record ${record.id}:`, updateError);
                    }
                }
            }
        } catch (error) {
            console.error(`Error updating all records with file ${fileName}:`, error);
        }
    }
    async updateOverallStatus(recordId) {
        try {
            const downloadRecord = await DownloadVideos.findByPk(recordId);
            if (!downloadRecord) {
                console.error(`Record ${recordId} not found`);
                return;
            }
            // Make sure file_details is an array
            const fileDetails = Array.isArray(downloadRecord.file_details) ? 
                downloadRecord.file_details : [];
            // Check overall status
            const allCompleted = fileDetails.every(file => file.status === 'completed');
            const anyFailed = fileDetails.some(file => file.status === 'failed');
            const anyDownloading = fileDetails.some(file => file.status === 'downloading');
            const anyPending = fileDetails.some(file => file.status === 'pending');
            let finalStatus;
            if (allCompleted) {
                finalStatus = 'completed';
            } else if (anyFailed) {
                if (fileDetails.some(file => file.status === 'completed')) {
                    if (anyDownloading || anyPending) {
                        finalStatus = 'in_progress';
                    } 
// else {
//                         finalStatus = 'partially_completed';
//                     }
                } else {
                    finalStatus = 'failed';
                }
            } else if (anyDownloading || anyPending) {
                finalStatus = 'in_progress';
            } else {
                finalStatus = 'completed';
            }
            // Update final status
            await downloadRecord.update({
                download_status: finalStatus,
                details: {
                    last_updated_at: new Date(),
                    success_count: fileDetails.filter(f => f.status === 'completed').length,
                    failed_count: fileDetails.filter(f => f.status === 'failed').length,
                    pending_count: fileDetails.filter(f => f.status === 'pending').length,
                    downloading_count: fileDetails.filter(f => f.status === 'downloading').length,
                    total_count: fileDetails.length
                }
            });
            
            console.log(`Updated overall status for record ${recordId} to ${finalStatus}`);
        } catch (error) {
            console.error(`Error updating status for record ${recordId}:`, error);
        }
    }
    async processDownload(recordId, batchName, date, fileDetails, downloadKey) {
        let sftpA = null;
        
        try {
            console.log(`Starting download process for record ${recordId}`);
            
            // Get the download record
            const downloadRecord = await DownloadVideos.findByPk(recordId);
            if (!downloadRecord) {
                console.error(`Download record ${recordId} not found`);
                this.activeDownloads.delete(downloadKey);
                return;
            }
            
            // Get student ID for student-specific paths
            const student_id = downloadRecord.student_id;
            
            // Convert all path components to strings to avoid type errors 
            const localDirStr = String(this.localDir);
            const batchNameStr = String(batchName);
            
            // Create student-specific download directory path
            const studentDownloadDir = path.join(localDirStr, batchNameStr);
            
            // Ensure directory exists
            await fs.promises.mkdir(studentDownloadDir, { recursive: true });
            
            // Log directory for debugging
            console.log(`Created download directory: ${studentDownloadDir}`);
            
            // Make sure we're working with the most current file details
            const currentRecord = await DownloadVideos.findByPk(recordId);
            const currentFileDetails = currentRecord.file_details || [];
            
            // Process each pending file one by one
            const pendingFiles = currentFileDetails.filter(f => f.status === 'pending');
            console.log(`Found ${pendingFiles.length} pending files to download for record ${recordId}`);
            
            if (pendingFiles.length === 0) {
                console.log(`No pending files to download for record ${recordId}`);
                this.activeDownloads.delete(downloadKey);
                return;
            }
            
            // Connect to SFTP once for all files
            sftpA = await connectSFTP(serverAConfig, "Server A");
            
            for (const file of pendingFiles) {
                try {
                    // Update file status to downloading in database
                    await this.updateFileStatus(recordId, file.name, 'downloading');
                    
                    // Convert all path components to strings
                    const remoteDirStr = String(this.remoteDir);
                    const fileNameStr = String(file.name);
                    
                    // Generate source and destination paths with explicit string conversion
                    const remoteSourcePath = path.join(remoteDirStr, batchNameStr, fileNameStr);
                    const localDestPath = path.join(studentDownloadDir, fileNameStr);
                    
                    console.log(`Downloading file from ${remoteSourcePath} to ${localDestPath}`);
                    
                    try {
                        // Use SFTP fastGet to download the file directly
                        await sftpA.fastGet(remoteSourcePath, localDestPath);
                        console.log(`Successfully downloaded file ${fileNameStr}`);
                    } catch (sftpError) {
                        throw new Error(`Failed to download file from server: ${sftpError.message}`);
                    }
                    
                    // Get file details
                    const fileStats = await fs.promises.stat(localDestPath);
                    const fileSize = fileStats.size;
                    
                    // Get video duration if it's a valid video file
                    let duration = "00:00:00";
                    if (fileSize > 0 && (fileNameStr.endsWith('.webm') || fileNameStr.endsWith('.mp4'))) {
                        try {
                            duration = await this.getVideoDuration(localDestPath);
                        } catch (durationErr) {
                            console.warn(`Failed to get duration for ${fileNameStr}: ${durationErr.message}`);
                        }
                    }
                    
                    // Update file status to completed in database
                    await this.updateFileStatus(recordId, fileNameStr, 'completed', {
                        download_end: new Date(),
                        size: fileSize,
                        duration
                    });
                    
                    console.log(`Successfully processed ${fileNameStr} for record ${recordId}`);
                } catch (fileError) {
                    console.error(`Error downloading ${file.name} for record ${recordId}:`, fileError);
                    
                    // Mark as failed in database
                    await this.updateFileStatus(recordId, file.name, 'failed', {
                        download_end: new Date(),
                        error: fileError.message
                    });
                }
            }
            
            // Update overall status
            await this.updateOverallStatus(recordId);
        } catch (error) {
            console.error(`Error in processDownload for record ${recordId}:`, error);
        } finally {
            // Close SFTP connection
            if (sftpA) {
                try {
                    await sftpA.end();
                } catch (closeError) {
                    console.error('Error closing SFTP connection:', closeError);
                }
            }
            
            // Always clean up the active download flag
            this.activeDownloads.delete(downloadKey);
        }
    }
    
    // Helper method to update file status
    async updateFileStatus(recordId, fileName, status, additionalData = {}) {
        try {
            // Always get fresh data from database
            const record = await DownloadVideos.findByPk(recordId);
            if (!record) {
                console.error(`Record ${recordId} not found for updating file status`);
                return;
            }
            
            // Make sure file_details is an array
            let fileDetails = Array.isArray(record.file_details) ? 
                JSON.parse(JSON.stringify(record.file_details)) : [];
            
            // Flag to check if any file was actually updated
            let fileUpdated = false;
            
            // Update the specific file
            fileDetails = fileDetails.map(file => {
                if (file.name === fileName) {
                    fileUpdated = true;
                    
                    // Add timestamps based on status
                    let fileData = { ...file, status };
                    
                    if (status === 'downloading' && !file.download_start) {
                        fileData.download_start = new Date();
                    } else if (status === 'completed' || status === 'failed') {
                        fileData.download_end = new Date();
                    }
                    
                    return { ...fileData, ...additionalData };
                }
                return file;
            });
            
            if (fileUpdated) {
                // Log the update
                console.log(`Updating file ${fileName} in record ${recordId} to status ${status}`);
                
                // Update the database record
                await record.update({ file_details: fileDetails });
                
                // Double-check the update was successful
                const verifyRecord = await DownloadVideos.findByPk(recordId);
                const updatedFile = verifyRecord.file_details.find(f => f.name === fileName);
                
                if (updatedFile && updatedFile.status === status) {
                    console.log(`Successfully updated file ${fileName} status to ${status}`);
                } else {
                    console.error(`Failed to update file ${fileName} status to ${status}`);
                }
            }
        } catch (error) {
            console.error(`Error updating file status for ${fileName} in record ${recordId}:`, error);
        }
    }
    async getDownloadStatus(student_id, batch_name, date) {
        try {
            const record = await DownloadVideos.findOne({
                where: {
                    student_id,
                    batch_name,
                    requested_date: date,
                    delete_status: false
                }
            });
            if (!record) {
                return {
                    status: 'not_found',
                    message: 'No download record found'
                };
            }
            // Make sure file_details is an array
            const fileDetails = Array.isArray(record.file_details) ? record.file_details : [];
            
            const completedFiles = fileDetails.filter(f => f.status === 'completed').length;
            const totalFiles = fileDetails.length;
            const failedFiles = fileDetails.filter(f => f.status === 'failed').length;
            const pendingFiles = fileDetails.filter(f => f.status === 'pending').length;
            const downloadingFiles = fileDetails.filter(f => f.status === 'downloading').length;
            return {
                id: record.id,
                student_id: record.student_id,
                batch_name: record.batch_name,
                date: record.requested_date,
                status: record.download_status,
                progress: {
                    completed: completedFiles,
                    failed: failedFiles,
                    pending: pendingFiles,
                    downloading: downloadingFiles,
                    total: totalFiles,
                    percent: totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0
                },
                files: fileDetails,
                details: record.details,
                created_at: record.createdAt,
                updated_at: record.updatedAt
            };
        } catch (error) {
            console.error('Error getting download status:', error);
            throw error;
        }
    }
    async getAllDownloads(student_id, options = {}) {
        try {
            const where = { student_id };
            if (options.batch_name) {
                where.batch_name = options.batch_name;
            }
            if (options.status) {
                where.download_status = options.status;
            }
            // By default, only show active (non-deleted) downloads
            if (!('delete_status' in options)) {
                where.delete_status = false;
            } else if (options.delete_status !== null) {
                where.delete_status = options.delete_status;
            }
            const records = await DownloadVideos.findAll({
                where,
                order: [['createdAt', 'DESC']]
            });
            return records.map(record => {
                // Make sure file_details is an array
                const fileDetails = Array.isArray(record.file_details) ? record.file_details : [];
                
                return {
                    id: record.id,
                    student_id: record.student_id,
                    batch_name: record.batch_name,
                    date: record.requested_date,
                    status: record.download_status,
                    file_count: fileDetails.length,
                    completed_count: fileDetails.filter(f => f.status === 'completed').length,
                    pending_count: fileDetails.filter(f => f.status === 'pending').length,
                    downloading_count: fileDetails.filter(f => f.status === 'downloading').length,
                    failed_count: fileDetails.filter(f => f.status === 'failed').length,
                    created_at: record.createdAt,
                    updated_at: record.updatedAt
                };
            });
        } catch (error) {
            console.error('Error getting all downloads:', error);
            throw error;
        }
    }
}
// Create API route controllers
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
            "/home/recorded-class-backend/public/videos/downloaded_videos/"
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
            "/home/recorded-class-backend/public/videos/downloaded_videos/"
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
// const getAllDown
module.exports = {
    EnhancedVideoFileManager,
    getVideoFilesRoute,
    getDownloadStatusRoute,
    // getAllDownloadsRoute
};
