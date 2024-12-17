const fs = require("fs");
const path = require("path");
const AbsentRecord = require("../models/absent_records");
const sequelize = require("../config/db");

const video_request = async (req, res) => {
    try {
      const { student_id, batch_name, absent_date } = req.body;
  
      if (!student_id || !batch_name || !absent_date) {
          return res.status(400).json({ error: "Missing required fields." });
      }
      const currentDate = new Date();
      const dateObj = new Date(absent_date);
      if (dateObj > currentDate) {
        return res.status(400).json({ error: "Cannot request for future dates" });
      }
      const existingRecord = await AbsentRecord.findOne({
         where: { student_id , batch_name, absent_date},
        });
       if (existingRecord) {
        console.log("Existing record found");
        return res.status(200).json({
          message: "Existing record found",
          record: existingRecord,
        });
       }else{
        console.log("No existing record found. Creating new entry...");
         const newRecord = await AbsentRecord.create({
          student_id,
          batch_name,
          absent_date,
      });
      return res.status(201).json({
        message: "New record created",
        record: newRecord,
      });
        
    }
  } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "Failed to add absent record." });
  }
  };
  
  
  const video_request_approve = async (req, res) => {
    try {
      const { id, user_role_id, approved_status, reason} = req.body;; 
      if (approved_status=== false && reason == ""){
        return res.status(400).json({ message: "Please provide reject reason" });
      } 
      if (user_role_id == 1){
        const record = await AbsentRecord.findOne({
          where: { id },
         });
        
  
        if (record) {
          record.approved_status = approved_status;
          const newDetails = {
            approved_by_id: 1,
            approved_by: "sdfs",
            reviewed_at: new Date().toISOString(),
            reject_reason: reason || "",
          };
      
          const currentDetails = Array.isArray(record.details) ? record.details : [];
          currentDetails.push(newDetails);
          record.details = currentDetails;
          record.changed("details", true); // Mark as modified
          await record.save();
          console.log("Updated details:", record.details);
        } else {
          console.log("Record not found");
        }
    
        return res.status(200).json({
            message: "Approved status updated successfully",
            record,
        });
      }else{
        return res.status(401).json({ message: "You dont have access to perform this action" });
      }
  } catch (error) {
      console.error("Error updating approved status:", error);
      return res.status(500).json({ message: "Internal server error", error });
  }
  }
// get requested list for admin 
const getRequests = async (req, res) => {
    try {
        // Get 'page' and 'limit' from query parameters
        const page = parseInt(req.query.page) || 1; 
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        console.log("Page:", page, "Limit:", limit, "Offset:", offset);

        // Query to fetch records with LIMIT and OFFSET
        const recordsQuery = `
            SELECT * FROM absent_records
            ORDER BY id ASC
            LIMIT :limit OFFSET :offset
        `;

        const records = await sequelize.query(recordsQuery, {
            replacements: { limit, offset },
            type: sequelize.QueryTypes.SELECT,
        });

        // Query to get the total count of records
        const countQuery = `SELECT COUNT(*) AS count FROM absent_records`;
        const [countResult] = await sequelize.query(countQuery, {
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