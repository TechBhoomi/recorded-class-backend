const fs = require('fs-extra');
const path = require("path");
const AbsentRecord = require("../models/absent_records");
const sequelize = require("../config/db");
const SftpClient = require("ssh2-sftp-client");
const { AbsentDateValidation } = require("./stream");
const { log } = require("console");
const { transferFiles, connectSFTP } = require("../helpers/video_downloads")

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

        const newDetails = {
          reviewed_by: "auto",
          reviewed_by_id: "-",
          reject_reason: "No videos found for the requested date.",
          reviewed_at: new Date().toISOString(),
        };
        await AbsentRecord.update(
          { is_inactive: true, approved_status: false, details: newDetails },
          { where: { student_id, batch_name, requested_date, is_inactive: false } }
        );
      } else {

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
    // Get 'page', 'limit', and 'student_id' from query parameters
    const { id, search_key, approved, contact } = req.query;
    const student_id = parseInt(req.query.st_id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    console.log("Student ID:", parseInt(student_id), "id:", id, "Page:", page, "Limit:", limit, "Offset:", offset, "contact", contact);

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
      } else if (approved === '0') {
        recordsQuery += ` AND approved_status = false AND is_inactive = true`;
      } else if (approved === '1') {
        recordsQuery += ` AND approved_status = true AND is_inactive = true`;
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
    }
    if (student_id) {
      countQuery += ` AND student_id = :student_id`;
    }
    if (parseInt(id)) {
      countQuery += ` AND id = :id`;
    }
    // approved 1 , rejected -0 pending -3
    if (approved) {
      if (approved === '3') {
        countQuery += ` AND approved_status = false AND is_inactive = false`;
      } else if (approved === '0') {
        countQuery += ` AND approved_status = false AND is_inactive = true`;
      } else if (approved === '1') {
        countQuery += ` AND approved_status = true AND is_inactive = true`;
      }
    }
    if (search_key) {
      countQuery += ` AND batch_name ILIKE '%${search_key}%' `;
    }
    const [countResult] = await sequelize.query(countQuery, {
      replacements: { student_id, id, approved, search_key, contact },
      type: sequelize.QueryTypes.SELECT,
    });

    const totalRecords = parseInt(countResult.count);
    const totalPages = Math.ceil(totalRecords / limit);

    // For each record, check the DownloadVideos table
    const recordsWithDownloadCount = await Promise.all(
      records.map(async (record) => {
        const downloadCountQuery = `
          SELECT COUNT(*) AS download_count
          FROM download_videos
          WHERE batch_name = :batch_name
            AND student_id = :student_id
            AND requested_date = :requested_date
        `;
        const [downloadCountResult] = await sequelize.query(downloadCountQuery, {
          replacements: {
            batch_name: record.batch_name,
            student_id: record.student_id,
            requested_date: record.requested_date,
          },
          type: sequelize.QueryTypes.SELECT,
        });
        return {
          ...record,
          download_count: parseInt(downloadCountResult.download_count),
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


// 
const remoteDir = "/home/techreactive/var/www/html/videos/";
const localDir = "/home/recorded-class-backend/public/videos/downloaded_videos/";

const serverAConfig = {
  host: "92.204.168.59",
  user: "root",
  password: "uhMJ4WJmTFhF",
  port: 22,
  readyTimeout: 600000
};
// Optimized SFTP fetch function
// Connection pool to reuse SFTP connections
// const ConnectionPool = {
//   connections: new Map(),
//   async getConnection(config, serverName) {
//     const key = `${config.host}:${config.port}`;
//     let connection = this.connections.get(key);

//     if (connection?.sftp) {
//       try {
//         // Test if connection is still alive
//         await connection.sftp.list('/');
//         return connection.sftp;
//       } catch (error) {
//         // Connection dead, remove it
//         this.connections.delete(key);
//       }
//     }

//     // Create new connection
//     const sftp = new SftpClient();
//     await this.connectWithRetry(sftp, config, serverName);

//     this.connections.set(key, {
//       sftp,
//       lastUsed: Date.now()
//     });

//     return sftp;
//   },

//   async connectWithRetry(sftp, config, serverName) {
//     let retries = 3;
//     let lastError;

//     while (retries > 0) {
//       try {
//         await sftp.connect(config);
//         return;
//       } catch (error) {
//         lastError = error;
//         retries--;
//         if (retries > 0) {
//           await new Promise(resolve => setTimeout(resolve, 1000));
//         }
//       }
//     }
//     throw lastError;
//   },

//   // Clean up old connections periodically
//   cleanup() {
//     const MAX_IDLE_TIME = 5 * 60 * 1000; // 5 minutes
//     for (const [key, connection] of this.connections.entries()) {
//       if (Date.now() - connection.lastUsed > MAX_IDLE_TIME) {
//         connection.sftp.end();
//         this.connections.delete(key);
//       }
//     }
//   }
// };

// // Start cleanup interval
// setInterval(() => ConnectionPool.cleanup(), 60000);

// // Cache for video file listings
// const FileListCache = {
//   cache: new Map(),
//   TTL: 5 * 60 * 1000, // 5 minutes

//   set(key, value) {
//     this.cache.set(key, {
//       value,
//       timestamp: Date.now()
//     });
//   },

//   get(key) {
//     const entry = this.cache.get(key);
//     if (!entry) return null;
//     if (Date.now() - entry.timestamp > this.TTL) {
//       this.cache.delete(key);
//       return null;
//     }
//     return entry.value;
//   }
// };

// async function fetchVideoDetails(batch_name, date) {
//   const cacheKey = `${batch_name}:${date}`;
//   const cachedResult = FileListCache.get(cacheKey);
//   if (cachedResult) {
//     return cachedResult;
//   }

//   const batchRemoteDir = path.join(String(remoteDir), String(batch_name));

//   try {
//     const sftpA = await ConnectionPool.getConnection(serverAConfig, "Server A");
//     const files = await sftpA.list(batchRemoteDir);
//     const dateFiles = files.filter(file => file.name.includes(date));

//     const result = {
//       files: dateFiles,
//       unavailableFiles: dateFiles.length ? [] : [date],
//       error: null
//     };

//     FileListCache.set(cacheKey, result);
//     return result;

//   } catch (error) {
//     console.error('SFTP Error:', error.message);
//     return { files: [], unavailableFiles: [], error: error.message };
//   }
// }

// // Optimize the video request handler to use batch operations
// const video_request = async (req, res) => {
//   try {
//     const {
//       student_id,
//       batch_name,
//       requested_date,
//       active_videos = [],
//       comment = '',
//       name,
//       contact,
//       email
//     } = req.body;

//     if (!student_id || !batch_name || !requested_date ) {
//       return res.status(400).json({ error: "Missing required fields." });
//     }

//     const currentDate = new Date().setHours(0, 0, 0, 0);
//     const requestedDateObj = new Date(requested_date).setHours(0, 0, 0, 0);

//     if (requestedDateObj > currentDate) {
//       return res.status(400).json({ error: "Cannot request for future dates" });
//     }

//     const active_video_dates = [...new Set(
//       active_videos.map(date => new Date(date).toISOString().split('T')[0])
//     )];

//     // Batch database operations
//     const [existingRecord, localFiles] = await Promise.all([
//       AbsentRecord.findOne({
//         where: {
//           student_id,
//           batch_name,
//           requested_date,
//           is_inactive: false
//         }
//       }),
//       fs.promises.readdir(path.resolve(process.env.VIDEO_PATH2, batch_name))
//         .catch(() => [])
//     ]);

//     if (existingRecord) {
//       return res.status(400).json({
//         message: "Existing request found!",
//         record: existingRecord,
//       });
//     }

//     // Check local files first before SFTP
//     const matchingLocalFiles = localFiles.filter(file =>
//       file.includes(requested_date) && /\.(webm|mp4)$/.test(file)
//     );

//     let videoFiles;
//     if (!matchingLocalFiles.length) {
//       const { files: remoteFiles } = await fetchVideoDetails(batch_name, requested_date);
//       videoFiles = remoteFiles;
//     } else {
//       videoFiles = matchingLocalFiles.map(file => ({ name: file }));
//     }

//     if (!videoFiles.length) {
//       return res.status(404).json({
//         message: `Video not available for the requested date: ${requested_date}`
//       });
//     }

//     const newRecord = await AbsentRecord.create({
//       student_id,
//       batch_name,
//       requested_date,
//       video_details: {
//         active_video_dates,
//         requested_video_date: requested_date
//       },
//       student_details: { name, contact, email },
//       comment
//     });

//     return res.status(200).json({
//       message: "Request created successfully!",
//       record: newRecord,
//     });

//   } catch (error) {
//     console.error("Error:", error);
//     res.status(500).json({ error: "Failed to add absent record." });
//   }
// };

module.exports = { video_request, video_request_approve, getRequests };