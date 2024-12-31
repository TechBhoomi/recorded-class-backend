const fs = require("fs");
const path = require("path");
const AbsentRecord = require("../models/absent_records");
const sequelize = require("../config/db");
const { AbsentDateValidation } = require("./stream");


const video_request = async (req, res) => {
    try {
      const { student_id, batch_name, requested_date,active_videos } = req.body;
      let active_video_dates = active_videos 
      if (!student_id || !batch_name || !requested_date || !active_video_dates) {
          return res.status(400).json({ error: "Missing required fields." });
      }
      // active videos sort and remove duplicates
      active_video_dates = active_video_dates
        .map(date => new Date(date).toISOString().split('T')[0]) // Normalize dates to YYYY-MM-DD
        .filter((date, index, self) => self.indexOf(date) === index)
        .sort((a, b) => new Date(a) - new Date(b));
      // 
      const currentDate = new Date();
      const dateObj = new Date(requested_date);
      if (dateObj > currentDate) {
        return res.status(400).json({ error: "Cannot request for future dates" });
      }
      const existingRecord = await AbsentRecord.findOne({
         where: { student_id , batch_name, requested_date, is_inactive: false},
        });

      // 
      const videoRootDirectory = process.env.VIDEO_PATH;
            console.log(videoRootDirectory, "videoRootDirectory");
          
            const videoDirPath = path.resolve(videoRootDirectory, batch_name);
            console.log(videoDirPath, "videoDirPath");
            try {
              await fs.promises.access(videoDirPath, fs.constants.R_OK);
            } catch (err) {
              console.error(`Directory does not exist or is not accessible: ${videoDirPath}`, err);
              return res
                .status(404)
                .json({ message: `Directory not found: ${batch_name}`
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
                .json({ message: `Video not available for the requested date: ${requested_date}`
                  // , details: err.message 
                });
        } else {
          console.log("Object is not empty");
          if (existingRecord) {
            console.log("Existing record found");
            return res.status(200).json({
              message: "Existing record found",
              record: existingRecord,
            });
           }else{
            console.log("No existing record found. Creating new entry...");
            const video_details = {
              "active_video_dates":active_video_dates,
              "requested_video_date":requested_date
            }
             const newRecord = await AbsentRecord.create({
              student_id,
              batch_name,
              requested_date,
              video_details
          });
          return res.status(200).json({
            message: "New record created",
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
      const student_id = parseInt(req.query.st_id);
      const page = parseInt(req.query.page) || 1; 
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      console.log("Student ID:", student_id, "Page:", page, "Limit:", limit, "Offset:", offset);

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

      recordsQuery += ` ORDER BY is_inactive,"createdAt" LIMIT :limit OFFSET :offset`;

      const records = await sequelize.query(recordsQuery, {
          replacements,
          type: sequelize.QueryTypes.SELECT,
      });

      // Query to get the total count of records with WHERE condition
      let countQuery = `SELECT COUNT(*) AS count FROM absent_records WHERE 1=1`;

      if (student_id) {
          countQuery += ` AND student_id = :student_id`;
      }

      const [countResult] = await sequelize.query(countQuery, {
          replacements: { student_id },
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



  module.exports = { video_request, video_request_approve,getRequests};