const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');
const { Sequelize, Op } = require('sequelize');
const cron = require('node-cron');

// Import the DownloadVideos model
const  DownloadVideos  = require('../models/download_videos');

class DownloadedVideosCleanup {
    constructor(localDir) {
        this.localDir = localDir;
    }

    async cleanupExpiredFiles() {
        console.log(`[${moment().format('YYYY-MM-DD HH:mm:ss')}] Starting cleanup of expired downloaded video files...`);

        try {
            // Find all records where active_upto date has passed and not deleted yet
            const expiredRecords = await DownloadVideos.findAll({
                where: {
                    active_upto: { [Op.lt]: new Date() }, // Less than current timestamp
                    delete_status: false
                },
              
            });


            console.log(`Found ${expiredRecords.length} expired download records to process.`);

            if (expiredRecords.length === 0) {
                console.log('No expired records found. Cleanup complete.');
                return;
            }

            // Group records by batch_name and requested_date to process them together
            const groupedRecords = {};

            expiredRecords.forEach(record => {
                // Format the requested_date to YYYY-MM-DD to ensure consistent grouping
                const formattedDate = moment(record.requested_date).format('YYYY-MM-DD');
                const key = `${record.batch_name}_${formattedDate}`;

                if (!groupedRecords[key]) {
                    groupedRecords[key] = [];
                }
                groupedRecords[key].push(record);
            });

            // Process each group
            for (const [key, records] of Object.entries(groupedRecords)) {
                const [batchName, requestedDateStr] = key.split('_');

                // Parse the formatted date string back to a Date object
                const requestedDate = moment(requestedDateStr).toDate();

                // Get the requested date in YYYY-MM-DD format for database comparison
                const formattedRequestedDate = moment(requestedDate).format('YYYY-MM-DD');

                console.log(`Processing group: Batch ${batchName}, Date ${formattedRequestedDate}`);

                // Check if there are any active records with the same batch_name and requested_date
                const activeRecordsWithSameBatchAndDate = await DownloadVideos.findAll({
                    where: {
                        batch_name: batchName,
                        delete_status: false,
                        active_upto: {
                            [Op.gte]: new Date() // Greater than or equal to current date (still active)
                        }
                    }
                });

                // Filter the active records to only include ones with the matching requested_date
                const activeRecords = activeRecordsWithSameBatchAndDate.filter(record => {
                    const recordDateStr = moment(record.requested_date).format('YYYY-MM-DD');
                    return recordDateStr === formattedRequestedDate;
                });

                console.log(`Group ${key}: Found ${records.length} expired records, ${activeRecords.length} still active with same date.`);

                if (activeRecords.length > 0) {
                    console.log(`Skipping deletion for batch ${batchName}, date ${formattedRequestedDate} as there are still active records.`);
                    continue;
                }

                // Get the files to delete
                const filesToDelete = new Set();
                records.forEach(record => {
                    if (record.file_details && Array.isArray(record.file_details)) {
                        record.file_details.forEach(file => {
                            if (file.name) {
                                // Check if the file name contains the requested date
                                // Using the date part from the filename - assumes filenames contain ISO date format
                                const dateInFileName = file.name.split('T')[0]; // Extract YYYY-MM-DD part
                                if (dateInFileName === formattedRequestedDate) {
                                    filesToDelete.add(file.name);
                                }
                            }
                        });
                    }
                });

                console.log(`Will delete ${filesToDelete.size} files for batch ${batchName}, date ${formattedRequestedDate}.`);

                // Delete the files
                for (const fileName of filesToDelete) {
                    const filePath = path.join(this.localDir, batchName, fileName);
                    try {
                        if (await fs.pathExists(filePath)) {
                            await fs.unlink(filePath);
                            console.log(`Deleted file: ${filePath}`);
                        } else {
                            console.log(`File already removed or not found: ${filePath}`);
                        }
                    } catch (error) {
                        console.error(`Error deleting file ${filePath}:`, error);
                    }
                }

                // Update all records as deleted
                const recordIds = records.map(record => record.id);
                await DownloadVideos.update(
                    {
                        delete_status: true,
                        details: {
                            ...(records[0].details || {}),
                            deleted_at: new Date(),
                            deletion_reason: 'Expired active_upto date'
                        }
                    },
                    {
                        where: {
                            id: {
                                [Op.in]: recordIds
                            }
                        }
                    }
                );

                console.log(`Updated ${recordIds.length} records as deleted for batch ${batchName}, date ${formattedRequestedDate}.`);
            }

            // Check for empty directories and clean them up
            await this.cleanupEmptyDirectories();

            console.log(`[${moment().format('YYYY-MM-DD HH:mm:ss')}] Cleanup completed successfully.`);
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    // Rest of the class remains the same...
    async cleanupEmptyDirectories() {
        try {
            // Get all directories in the base local directory
            const directories = await fs.readdir(this.localDir);

            for (const dir of directories) {
                const dirPath = path.join(this.localDir, dir);

                // Skip if it's not a directory
                const stats = await fs.stat(dirPath);
                if (!stats.isDirectory()) continue;

                // Check if directory is empty
                const files = await fs.readdir(dirPath);
                if (files.length === 0) {
                    await fs.rmdir(dirPath);
                    console.log(`Removed empty directory: ${dirPath}`);
                }
            }
        } catch (error) {
            console.error('Error cleaning up empty directories:', error);
        }
    }
}

// Initialize and export the cleanup service
const videoCleanupService = new DownloadedVideosCleanup(
    "/home/recorded-class-backend/public/videos/downloaded_videos/"
);

// Setup cron job to run daily at midnight
function setupCleanupCron() {
    // Run at 00:00 (midnight) every day
    cron.schedule('0 0 * * *', async () => {
        console.log('Running scheduled cleanup job for expired video downloads');
        await videoCleanupService.cleanupExpiredFiles();
    });

    console.log('Video cleanup cron job scheduled to run daily at midnight');
}

// Manual trigger function for testing
async function runManualCleanup() {
    console.log('Running manual cleanup job for expired video downloads');
    await videoCleanupService.cleanupExpiredFiles();
}

module.exports = {
    setupCleanupCron,
    runManualCleanup,
    DownloadedVideosCleanup
};