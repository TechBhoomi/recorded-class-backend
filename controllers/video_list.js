const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const moment = require('moment');
const AbsentRecord = require("../models/absent_records");
const { transferFiles } = require("../helpers/video_downloads");
// const { backgroundFileCheck } = require("../helpers/clear_files");
// const { checkAndCleanupFiles } = require("../helpers/file_clean_up");
class VideoManagementSystem {
    constructor(remoteDir, localDir) {
        this.remoteDir = remoteDir;
        this.localDir = localDir;
        this.maxDates = 5;
    }

    // Filter dates that are within 7 days and not in future
    filterValidDates(absentDates) {
        // moment(testDate).format('MM/DD/YYYY');
        const today = moment();
        const thirtyDaysAgo = moment().subtract(7, 'days');

        return absentDates
            .filter(date => {
                const momentDate = moment(date);
                return momentDate.isBetween(thirtyDaysAgo, today, 'day', '[]');
            })
            .sort((a, b) => moment(a).diff(moment(b)))
            .slice(0, this.maxDates);
    }

    // Check if files exist for a specific date
    async checkFilesExist(batchName, date) {
        const localBatchDir = path.join(this.localDir, batchName);
        if (!fs.existsSync(localBatchDir)) {
            return false;
        }

        const files = await fs.promises.readdir(localBatchDir);
        return files.some(file => file.startsWith(date));
    }

    // Update ResultArr with approved request
    async updateResultWithRequest(resultArr, requestedDate) {
        // Create a copy of the array without null values
        let cleanArr = resultArr.filter(date => date !== null);

        if (cleanArr.length >= this.maxDates) {
            cleanArr.shift(); // Remove oldest date
        }

        // Add the new date only if it's not already in the array
        if (!cleanArr.includes(requestedDate)) {
            cleanArr.push(requestedDate);
        }

        return cleanArr;
    }

    // Handle file downloads separately
    async handleDownloads(batchName, dates) {
        try {
            for (const date of dates) {
                const filesExist = await this.checkFilesExist(batchName, date);
                if (!filesExist) {
                    await transferFiles(batchName, date);
                }
            }
        } catch (error) {
            console.error('Error in handleDownloads:', error);
            // Log error but don't throw since this runs after response
        }
    }

    // Main function to get and process dates
    async getVideoDates(studentId, batchName, absentDates) {
        try {
            const thirtyDaysAgo = moment().subtract(7, 'days').startOf('day');

            // Get approved requests from database
            const approvedRequests = await AbsentRecord.findAll({
                where: {
                    student_id: studentId,
                    batch_name: batchName,
                    approved_status: true,
                    updatedAt: { [Op.gte]: thirtyDaysAgo },
                },
                order: [["id", "ASC"]],
            });

            // Filter valid absent dates
            let resultArr = this.filterValidDates(absentDates);
            console.log(resultArr, "resultArr111");

            // Add approved requests that are still within 7 days
            for (const request of approvedRequests) {
                const requestDate = moment(new Date(request.requested_date)).utc();
                // requestDate.isAfter(thirtyDaysAgo) &&
                if (
                    !resultArr.includes(request.requested_date)) {
                    resultArr = await this.updateResultWithRequest(resultArr, request.requested_date);
                }
            }

            // Start downloads in background
            // this.handleDownloads(batchName, resultArr).catch(error => {
            //     console.error('Background download error:', error);
            // });
        console.log(resultArr,"resultArr222");
        
            return resultArr;
        } catch (error) {
            console.error('Error in getVideoDates:', error);
            throw error;
        }
    }
}

// Express route handler
const getVideoRoute = async (req, res) => {
    try {
        const { student_id, batch_name, absent_date } = req.body;
        const payload = req.body
        const videoManager = new VideoManagementSystem(
            "/home/techreactive/var/www/html/videos/",
            "/home/recorded-class-backend/public/videos/downloaded_videos/"
        );

        const dates = await videoManager.getVideoDates(
            student_id,
            batch_name,
            absent_date
        );
        // backgroundFileCheck(payload)
        //         .then(result => {
        //             console.log('Background process completed:', result);
        //         })
        //         .catch(error => {
        //             console.error('Background process failed:', error);
        //         });
        // checkAndCleanupFiles(batch_name)
        //         .then(() => console.log('Background file checking complete'))
        //         .catch(err => console.error('Background file checking failed:', err));
        
        res.json({
            success: true,
            dates,
            downloadPath: path.join(videoManager.localDir, batch_name)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

module.exports = {
    VideoManagementSystem,
    getVideoRoute
};