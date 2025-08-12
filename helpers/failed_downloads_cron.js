const cron = require('node-cron');
const { EnhancedVideoFileManager } = require('../controllers/video_download');
const DownloadVideos = require('../models/download_videos');
const { Op,Sequelize  } = require('sequelize');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
// Create video manager instance
const videoManager = new EnhancedVideoFileManager(
    "/home/techreactive/var/www/html/videos",
    "/home/recorded-class-backend/public/videos/downloaded_videos/",
    "/var/www/html/node_recorder/videos/",
);

/**
 * Function to retry failed downloads
 */
async function retryFailedDownloads() {
    try {
        console.log('Starting retry of failed downloads...');

        // Find all records with download_status 'failed' and non-empty file_details
        const failedRecords = await DownloadVideos.findAll({
            where: {
                download_status: 'failed',
                [Op.and]: [
                    { file_details: { [Op.ne]: null } },
                    Sequelize.literal(`"file_details" != '[]'`)
                  ]
                // delete_status: false
            },
            limit: 50  // Process in batches to avoid overloading the system
        });

        console.log(`Found ${failedRecords.length} failed downloads to retry`);

        for (const record of failedRecords) {
            try {
                const alreadyDownloadedRecord = await DownloadVideos.findAll({
                    where: {
                        download_status: 'completed',
                        student_id: record.student_id,
                        batch_name: record.batch_name,
                        requested_date: record.requested_date,
                        delete_status: false
                    },
                    limit: 50  // Process in batches to avoid overloading the system
                });
                if(alreadyDownloadedRecord.length == 0){
                console.log(`Retrying download for record ID: ${record.id}, Student: ${record.student_id}, Batch: ${record.batch_name}`);

                const fileDetails = record.file_details || [];
                const downloadPath = `/home/recorded-class-backend/public/videos/downloaded_videos/${record.batch_name}`;
                let allFilesExist = true;
                
                // Map over file details to check if all files exist
                const updatedFileDetails = fileDetails.map(file => {
                    const expectedFilePath = path.join(downloadPath, file.name);
                    const fileExists = fs.existsSync(expectedFilePath);
                    console.log(expectedFilePath,"expectedFilePath");
                    
                    if (!fileExists) {
                        allFilesExist = false;
                        return {
                            ...file,
                            status: 'pending',
                            download_start: null,
                            download_end: null,
                            error: null
                        };
                    } else {
                        // File exists locally
                        return {
                            ...file,
                            status: 'completed',
                            download_start: file.download_start || new Date(),
                            download_end: file.download_end || new Date(),
                            error: null
                        };
                    }
                });
                
                // If all files exist locally, just update the record status to completed
                if (allFilesExist) {
                    console.log(`All files already exist locally for record ID: ${record.id}. Updating status to completed.`);
                    
                    await record.update({
                        download_status: 'completed',
                        file_details: updatedFileDetails,
                        active_upto: moment().add(7, 'days').toDate(),
                        details: {
                            ...record.details,
                            files_found_locally: true,
                            updated_at: new Date()
                        }
                    });
                    
                    continue; // Skip to next record since we've updated this one
                }
                
                // If we get here, some files need to be downloaded
                console.log(`Some files need to be downloaded for record ID: ${record.id}`);
                
                // Reset the download status to 'pending'
                await record.update({
                    download_status: 'pending',
                    file_details: updatedFileDetails,
                    details: {
                        ...record.details,
                        retry_initiated_at: new Date(),
                        retry_count: (record.details?.retry_count || 0) + 1
                    }
                });
                
                // Initiate download using the existing method
                const recordKey = `${record.student_id}_${record.batch_name}_${record.requested_date}`;
                const server = record.details?.server || 'ServerA'; // Default to ServerA if not specified
                
                // Process the download
                await videoManager.processDownload(
                    record.id,
                    record.batch_name,
                    record.requested_date,
                    updatedFileDetails,
                    recordKey,
                    server
                );
                
                // Check if the download completed successfully
                const updatedRecord = await DownloadVideos.findByPk(record.id);
                
                if (updatedRecord.download_status === 'completed') {
                    console.log(`Successfully retried download for record ID: ${record.id}`);
                    
                    // Update active_upto to 7 days from now
                    await updatedRecord.update({
                        active_upto: moment().add(7, 'days').toDate(),
                        details: {
                            ...updatedRecord.details,
                            retry_successful_at: new Date()
                        }
                    });
                } else {
                    console.log(`Retry attempt for record ID: ${record.id} did not complete successfully`);
                }
            }else{
                const updatedRecord = await DownloadVideos.findByPk(record.id);
                await updatedRecord.update({
                    download_status: 'already_download',
                   
                });
            }
            } catch (recordError) {
                console.error(`Error retrying download for record ID: ${record.id}:`, recordError);

                // Update record with error info
                await record.update({
                    download_status: 'failed',
                    details: {
                        ...record.details,
                        retry_error: recordError.message,
                        retry_failed_at: new Date()
                    }
                });
            }

            // Add a small delay between processing records to avoid overloading the system
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('Completed retry of failed downloads');
    } catch (error) {
        console.error('Error in retryFailedDownloads:', error);
    }
}

/**
 * Setup cron job to run daily at midnight
 * You can adjust the schedule as needed
 */
function setupRetryFailedDownloadsCron() {
    // Run every day at midnight
    cron.schedule('0 0 * * *', async () => {
        console.log('Running scheduled retry of failed downloads');
        await retryFailedDownloads();
    });

    console.log('Scheduled retry failed downloads cron job');
}

/**
 * Function to run the retry process manually
 */
async function runRetryFailedDownloadsManually() {
    console.log('Manually running retry of failed downloads');
    await retryFailedDownloads();
}

module.exports = {
    setupRetryFailedDownloadsCron,
    runRetryFailedDownloadsManually
};