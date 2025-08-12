const fs = require('fs-extra');
const path = require("path");
const AbsentRecord = require("../models/absent_records");
const sequelize = require("../config/db");
const SftpClient = require("ssh2-sftp-client");
const { AbsentDateValidation } = require("./stream");
const { log } = require("console");
const { transferFiles, connectSFTP } = require("../helpers/video_downloads")
const { fetchVideoDetails_RecordServer } = require("../helpers/video_downloads") 


const video_request = async (req, res) => {
  try {
    const { student_id, batch_name, requested_date, active_videos, comment, name, contact, email } = req.body;
    let active_video_dates = active_videos
    if (!student_id || !batch_name || !requested_date || !active_video_dates) {
      return res.status(400).json({ error: "Missing required fields." });
    }
    // active videos sort and remove duplicates
    active_video_dates = active_video_dates
      .map(date => new Date(date).toISOString().split('T')[0]) // Normalize dates to YYYY-MM-DD
      .filter((date, index, self) => self.indexOf(date) === index)

    const currentDate = new Date();
    const dateObj = new Date(requested_date);
    if (dateObj > currentDate) {
      return res.status(400).json({ error: "Cannot request for future dates" });
    }
    const existingRecord = await AbsentRecord.findOne({
      where: { student_id, batch_name, requested_date, is_inactive: false },
    });
    const existingRecordCount = await AbsentRecord.findAndCountAll({
      where: { student_id, batch_name, requested_date,approved_status:true },
    });
    // 
    console.log(existingRecordCount,"existingRecordCount");
    
    const videoRootDirectory = process.env.VIDEO_PATH2;
    console.log(videoRootDirectory, "videoRootDirectory");

    const videoDirPath = path.resolve(videoRootDirectory, batch_name);
    console.log(videoDirPath, "videoDirPath");
    try {
      await fs.promises.access(videoDirPath, fs.constants.R_OK);
    } catch (err) {
      await fs.ensureDir(videoDirPath);
      console.error(`Directory does not exist or is not accessible: ${videoDirPath}`, err);
      // return res
      //   .status(404)
      //   .json({
      //     message: `Directory not found: ${batch_name}`
      //     // , details: err.message 
      //   });
    }
    const files = await fs.promises.readdir(videoDirPath);
    const arr_absentDate = [requested_date];


    if (existingRecord) {
      return res.status(400).json({
        message: "Existing request found!",
        record: existingRecord,
      });
    } else {
      console.log("No existing record found. Creating new entry...");
      const student_details = {
        "name": name,
        "contact": contact,
        "email": email
      }
      const video_details = {
        "active_video_dates": active_video_dates,
        "requested_video_date": requested_date
      }

      const newRecord = await AbsentRecord.create({
        student_id,
        batch_name,
        requested_date,
        video_details: video_details,
        student_details,
        comment
      });

      res.status(200).json({
        message: "Request created successfully!",
        record: newRecord,
      });
      const result = await AbsentDateValidation(arr_absentDate, student_id, batch_name, files);
      console.log(result,"result");

      if (result[requested_date].length === 0) {
        console.log("Object is empty");
        // approved_status = false;
        const { files: downloadedFiles , unavailableFiles: unavailableDate , error } = await fetchVideoDetails_RecordServer(batch_name, requested_date);
        
        console.log(downloadedFiles, unavailableDate,"fetchVideoDetails_RecordServersfsdjfsdfsdfsjkgfkh");
        // result[requested_date] = downloadedFiles
        console.log(downloadedFiles.length === 0,"downloadedFiles.length === 0");
        
        if(downloadedFiles.length === 0 ){
          const newDetails = {
            reviewed_by: "auto",
            reviewed_by_id: "-",
            reject_reason: "No videos found for the requested date.",
            reviewed_at: new Date().toISOString(),
          };
          const file_availability = {
            is_available: false,
            file_status: "Unavailable"
          };
          await AbsentRecord.update(
            { is_inactive: true, approved_status: false, details: newDetails,file_availability: file_availability },
            { where: { student_id, batch_name, requested_date, is_inactive: false } }
          );
        }else{
          console.log("Processing ...available in main server , wait....");
          const { files: downloadedFiles = [], unavailableFiles: unavailableDates = [], error } =await transferFiles(batch_name, requested_date);

          const file_availability = {
            is_available: false,
            file_status: "Processing"
          };
          await AbsentRecord.update(
          {file_availability: file_availability },
          { where: { student_id, batch_name, requested_date, is_inactive: false } }
        );
        }
      } else {
        console.log("video available in storage server ");
        const file_availability = {
          is_available: true,
          file_status: "Available"
        };
        await AbsentRecord.update(
        {file_availability: file_availability },
        { where: { student_id, batch_name, requested_date, is_inactive: false } }
      );
      }

    }
    // }
    // 

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to add absent record." });
  }
};


const video_request_approve = async (req, res) => {
  try {

    const { id, role, user_id, user_name, approved_status, reason } = req.body;

    if (approved_status === false && reason === "") {
      return res.status(400).json({ message: "Please provide reject reason" });
    }

    if (role === 'admin' || role === "trackerverifier") {
      const record = await AbsentRecord.findOne({
        where: { id },
      });

      if (record) {
        if (record.is_inactive == false) {
          console.log(record.is_inactive, record.approved_status, "approved_status");

          record.is_inactive = true;
          record.approved_status = approved_status;

          const newDetails = {
            reviewed_by: user_name,
            reviewed_by_id: user_id,
            reject_reason: reason || "",
            reviewed_at: new Date().toISOString(),
          };
          if (approved_status === true) {

            console.log(record.video_details.active_video_dates);

            const oldData = [...record.video_details.active_video_dates];
            record.video_details.active_video_dates.push(record.video_details.requested_video_date);
            const newData = [...record.video_details.active_video_dates];

            const updatedVideoDetails = {
              active_video_dates: oldData,
              requested_video_date: record.video_details.requested_video_date,
              updated_dates: newData
            }
            console.log(updatedVideoDetails, "updatedVideoDetails");

            record.video_details = updatedVideoDetails

          }
          // Instead of pushing to an array, directly assign the object to 'details'
          record.details = newDetails;
          record.changed("details", true); // Mark as modified
          await record.save();
          console.log("Updated details:", record.details);
        } else {
          return res.status(200).json({
            message: "Record already Approved/Rejected",
            record,
          });
        }

      } else {
        console.log("Record not found");
        return res.status(200).json({
          message: "Record not found",
          record,
        });
      }
      return res.status(200).json({
        message: "Status updated successfully",
        record,
      });
    } else {
      return res.status(401).json({ message: "You don't have access to perform this action" });
    }
  } catch (error) {
    console.error("Error updating approved status:", error);
    return res.status(500).json({ message: "Internal server error", error });
  }
};

// get requested list for admin 
const getRequests = async (req, res) => {
  try {
    // Get query parameters
    const { id, search_key, approved, contact } = req.query;
    const student_id = parseInt(req.query.st_id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    console.log("Student ID:", parseInt(student_id), "id:", id, "Page:", page, "Limit:", limit, "Offset:", offset, "contact", contact);

    // Base query with common conditions
    let baseConditions = `FROM absent_records WHERE 1=1`;
    const replacements = { limit, offset };

    if (student_id) {
      baseConditions += ` AND student_id = :student_id`;
      replacements.student_id = student_id;
    }
    if (contact) {
      baseConditions += ` AND EXISTS (
        SELECT 1 
        FROM jsonb_array_elements(student_details->'contact') AS contacts
        WHERE contacts->>'number' = :contact) `;
      replacements.contact = contact;
    }
    if (parseInt(id)) {
      baseConditions += ` AND id = :id`;
      replacements.id = parseInt(id);
    }
    if (approved) {
      if (approved === '3') {
        baseConditions += ` AND approved_status = false AND is_inactive = false`;
      } else if (approved === '0') {
        baseConditions += ` AND approved_status = false AND is_inactive = true`;
      } else if (approved === '1') {
        baseConditions += ` AND approved_status = true AND is_inactive = true`;
      }
    }
    if (search_key) {
      baseConditions += ` AND batch_name ILIKE :search_key`;
      replacements.search_key = `%${search_key}%`;
    }

    // Query to fetch records
    let recordsQuery = `SELECT * ${baseConditions} ORDER BY is_inactive,"createdAt" desc LIMIT :limit OFFSET :offset`;
    const records = await sequelize.query(recordsQuery, {
      replacements,
      type: sequelize.QueryTypes.SELECT,
    });

    // Query to get the total count of records
    let countQuery = `SELECT COUNT(*) AS count ${baseConditions}`;
    const [countResult] = await sequelize.query(countQuery, {
      replacements,
      type: sequelize.QueryTypes.SELECT,
    });
    const totalRecords = parseInt(countResult.count);
    const totalPages = Math.ceil(totalRecords / limit);

    // For each record, check the counts with the same filters
    const recordsWithDownloadCount = await Promise.all(
      records.map(async (record) => {
        // Include the same contact filter in all count queries
        const contactCondition = contact ? ` AND EXISTS (
          SELECT 1 
          FROM jsonb_array_elements(student_details->'contact') AS contacts
          WHERE contacts->>'number' = :contact) ` : '';
        
        const downloadCountQuery = `
          SELECT COUNT(*) AS download_count
          FROM absent_records
          WHERE batch_name = :batch_name
            AND student_id = :student_id
            AND requested_date = :requested_date
            AND is_inactive = true
            ${contactCondition}
        `;
        
        const batchReqCountQuery = `
          SELECT COUNT(*) AS batch_req_count
          FROM absent_records
          WHERE batch_name = :batch_name
            AND student_id = :student_id
            AND is_inactive = true
            ${contactCondition}
        `;
        
        const batchReqAppCountQuery = `
          SELECT COUNT(*) AS batch_req_count
          FROM absent_records
          WHERE batch_name = :batch_name
            AND student_id = :student_id
            AND is_inactive = true 
            AND approved_status = true
            ${contactCondition}
        `;
        
        const batchReqRejCountQuery = `
          SELECT COUNT(*) AS batch_req_count
          FROM absent_records
          WHERE batch_name = :batch_name
            AND student_id = :student_id
            AND is_inactive = true 
            AND approved_status = false
            ${contactCondition}
        `;
        
        const queryReplacements = {
          batch_name: record.batch_name,
          student_id: record.student_id,
          requested_date: record.requested_date,
        };
        
        if (contact) {
          queryReplacements.contact = contact;
        }

        const [
          downloadCountResult,
          batchReqCountResult,
          batchReqAppCountResult,
          batchReqRejCountResult
        ] = await Promise.all([
          sequelize.query(downloadCountQuery, {
            replacements: queryReplacements,
            type: sequelize.QueryTypes.SELECT,
          }),
          sequelize.query(batchReqCountQuery, {
            replacements: queryReplacements,
            type: sequelize.QueryTypes.SELECT,
          }),
          sequelize.query(batchReqAppCountQuery, {
            replacements: queryReplacements,
            type: sequelize.QueryTypes.SELECT,
          }),
          sequelize.query(batchReqRejCountQuery, {
            replacements: queryReplacements,
            type: sequelize.QueryTypes.SELECT,
          })
        ]);

        return {
          ...record,
          download_count: parseInt(downloadCountResult[0].download_count),
          batch_req_count: parseInt(batchReqCountResult[0].batch_req_count),
          batch_req_app_count: parseInt(batchReqAppCountResult[0].batch_req_count),
          batch_req_rej_count: parseInt(batchReqRejCountResult[0].batch_req_count),
        };
      })
    );

    res.status(200).json({
      data: recordsWithDownloadCount,
      totalRecords: totalRecords,
      totalPages: totalPages,
      currentPage: page,
      limit: limit,
    });
  } catch (err) {
    console.error("Error fetching absent records:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


module.exports = { video_request, video_request_approve, getRequests };