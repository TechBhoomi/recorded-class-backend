const fs = require("fs");
const path = require("path");
const AbsentRecord = require("../models/absent_records");
const sequelize = require("../config/db");
const { AbsentDateValidation } = require("./stream");
const { log } = require("console");
const { transferFiles } = require("../helper/video_downloads")

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

    // 
    const videoRootDirectory = process.env.VIDEO_PATH2;
    console.log(videoRootDirectory, "videoRootDirectory");

    const videoDirPath = path.resolve(videoRootDirectory, batch_name);
    console.log(videoDirPath, "videoDirPath");
    try {
      await fs.promises.access(videoDirPath, fs.constants.R_OK);
    } catch (err) {
      console.error(`Directory does not exist or is not accessible: ${videoDirPath}`, err);
      return res
        .status(404)
        .json({
          message: `Directory not found: ${batch_name}`
          // , details: err.message 
        });
    }
    const files = await fs.promises.readdir(videoDirPath);
    const arr_absentDate = [requested_date];
    const result = await AbsentDateValidation(arr_absentDate, student_id, batch_name, files);
    if (Object.keys(result).length === 0) {
      console.log("Object is empty");
      return res
        .status(404)
        .json({
          message: `Video not available for the requested date: ${requested_date}`
          // , details: err.message 
        });
    } else {
      console.log("Object is not empty");
      if (existingRecord) {
        console.log("Existing record found");
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
        console.log(video_details, "vid details");
        // const videoDetailsString = JSON.stringify(video_details);
        console.log(student_id, batch_name, requested_date, video_details, comment, "payload");

        const newRecord = await AbsentRecord.create({
          student_id,
          batch_name,
          requested_date,
          video_details: video_details,
          student_details, // Pass the stringified JSON here
          comment
        });
        console.log(newRecord, "newRecord");

        return res.status(200).json({
          message: "Request created successfully!",
          record: newRecord,
        });

      }
    }
    // 

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to add absent record." });
  }
};


const video_request_approve = async (req, res) => {
  try {
    
    const { id, role, user_id, approved_status, reason } = req.body;

    if (approved_status === false && reason === "") {
      return res.status(400).json({ message: "Please provide reject reason" });
    }

    if (role === 'corporate_admin') {
      const record = await AbsentRecord.findOne({
        where: { id },
      });

      if (record) {
        record.is_inactive = true;
        record.approved_status = approved_status;

        const newDetails = {
          reviewed_by: "sdfs",
          reviewed_by_id: user_id,
          reject_reason: reason || "",
          reviewed_at: new Date().toISOString(),
        };
        if (approved_status === true) {
          await transferFiles(record.batch_name, record.video_details.requested_video_date);
          console.log(record.video_details.active_video_dates);

          const oldData = [...record.video_details.active_video_dates];
          record.video_details.active_video_dates.push(record.video_details.requested_video_date);
          const newData = [...record.video_details.active_video_dates];

          console.log("Old Data:", oldData); // Output: [10, 20, 30, 40, 50]
          console.log("New Data:", newData); // Output: [10, 20, 30, 40, 50, 60, 70, 80]
          // console.log(updated_date, x,"updated_date");

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
        console.log("Record not found");
        return res.status(200).json({
          message: "Record not found",
          record,
        });
      }

      return res.status(200).json({
        message: "Approved status updated successfully",
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
    // Get 'page', 'limit', and 'student_id' from query parameters
    const { id, search_key, approved, contact } = req.query
    const student_id = parseInt(req.query.st_id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    console.log("Student ID:", parseInt(student_id), "id:", id, "Page:", page, "Limit:", limit, "Offset:", offset, "contact",contact);

    // Query to fetch records with WHERE condition, LIMIT, and OFFSET
    let recordsQuery = `
          SELECT * FROM absent_records
          WHERE 1=1
      `;

    // Add WHERE clause if student_id is provided
    const replacements = { limit, offset };

    if (student_id) {
      recordsQuery += ` AND student_id = :student_id`;
      replacements.student_id = student_id;
    }
    if (contact) {
      recordsQuery += ` AND EXISTS (
    SELECT 1 
    FROM jsonb_array_elements(student_details->'contact') AS contacts
    WHERE contacts->>'number' = :contact) `;
      replacements.contact = contact;
    }
    if (parseInt(id)) {
      recordsQuery += ` AND id = :id`;
      replacements.id = parseInt(id);
    }
    if (approved) {
     
      if (approved === '3') {
         recordsQuery += ` AND approved_status = false AND is_inactive = false`;
        // replacements.approved = false;
      } else if (approved === '0') {
        recordsQuery += ` AND approved_status = false AND is_inactive = true`;
        // replacements.approved = approved;
      }else if (approved === '1'){
        recordsQuery += ` AND approved_status = true AND is_inactive = true`;
        // replacements.approved = tr;
      } 
    }
    if (search_key) {
      recordsQuery += ` AND batch_name ILIKE :search_key`;
      replacements.search_key = `%${search_key}%`; 
    }

    recordsQuery += ` ORDER BY is_inactive,"createdAt" desc LIMIT :limit OFFSET :offset`;

    const records = await sequelize.query(recordsQuery, {
      replacements,
      type: sequelize.QueryTypes.SELECT,
    });

    // Query to get the total count of records with WHERE condition
    let countQuery = `SELECT COUNT(*) AS count FROM absent_records WHERE 1=1`;
    if (contact) {
      countQuery += ` AND EXISTS (
    SELECT 1 
    FROM jsonb_array_elements(student_details->'contact') AS contacts
    WHERE contacts->>'number' = :contact) `;
      // replacements.contact = contact;
    }
    if (student_id) {
      countQuery += ` AND student_id = :student_id`;
    }
    if (parseInt(id)) {
      countQuery += ` AND id = :id`;
    }
    if (approved) {
      if (approved === '3') {
        countQuery += ` AND approved_status = false AND is_inactive = false`;
    //  replacements.approved = false;
     } else if(approved === '0') {
      countQuery += ` AND approved_status = false AND is_inactive = true`;
    //  replacements.approved = approved;
     }else if (approved === '1'){
      countQuery += ` AND approved_status = true AND is_inactive = true`;
     }
      // countQuery += ` AND approved_status = :approved`;
    }
    if (search_key) {
      countQuery += ` AND batch_name ILIKE '%${search_key}%' `;
    }
    const [countResult] = await sequelize.query(countQuery, {
      replacements: { student_id, id,approved, search_key,contact },
      type: sequelize.QueryTypes.SELECT,
    });

    const totalRecords = parseInt(countResult.count);
    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json({
      data: records,
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


// 



module.exports = { video_request, video_request_approve, getRequests };