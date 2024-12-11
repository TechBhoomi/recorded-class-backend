const fs = require("fs");
const path = require("path");
const AbsentRecord = require("../models/absent_records");


const stream = async (req, res) => {
    let url_path = req.query.path; 
if(url_path.includes("02_00.webm")){
  url_path = url_path.replace(" 02_00.webm", "+02_00.webm")
}
  const videoRootDirectory = process.env.VIDEO_PATH;
  const videoPath = path.resolve(
    videoRootDirectory,
    url_path
  );
  console.log(videoPath,"dfd");

  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ message: "file not found" });
  }
  try {
    const stat = await fs.promises.stat(videoPath);
    if (!stat.isFile()) {
      return res.status(404).json({ message: "file not found" });
    }
    res.setTimeout(30000, () => {
      res.status(504).json({ message: "Request timed out" });
    });

    // Streaming starts
    const readStream = fs.createReadStream(videoPath); 
    readStream.on("open", () => { 
      res.setHeader("Content-Type", "video/webm"); 
      readStream.pipe(res); 
    }); 

    readStream.on("error", err => {
      console.error("Error reading file:", err);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ message: "Internal Server Error Stream failed" });
      }
    });

    res.on("close", () => {
      readStream.destroy();
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({
      error: "Internal Server Error",
      data: err,
      path: videoPath,
    });
  }
};

// const stream = async (req, res) => {
//     console.log(req.body.absent_date);

//     const absentDate = req.query.absent_date; // Access 'absent_date'
//     const batchName = req.query.batch_name;  // Access 'batch_name'

//     console.log(absentDate, batchName);

//     // Define the root directory where the videos are stored
//     const videoRootDirectory = process.env.VIDEO_PATH

//     // Construct the full path to the directory that contains the videos
//     const videoDirPath = path.resolve(videoRootDirectory , batchName);
//   console.log(videoDirPath,"videoDirPath");

//     try {
//       // List all files in the specified directory
//       const files = await fs.promises.readdir(videoDirPath);

//       // Filter files whose name contains the absentDate (partial match) and ends with '.webm'
//       const videoFiles = files.filter(file => file.includes(absentDate) && file.endsWith(".webm"));

//       // If no matching videos are found
//       if (videoFiles.length === 0) {
//         return res.status(404).json({ message: "No videos found matching the given absent date." });
//       }

//       // Generate full paths for the matching videos
//       const videoPaths = videoFiles.map(file => path.join(videoDirPath, file)); // Full file path
//   console.log(videoPaths,"videoPaths");

//       // Return the list of full file paths
//       res.json({ absentDate: videoPaths });
//     } catch (err) {
//       console.error("Error reading directory:", err);
//       res.status(500).json({ error: "Internal Server Error", data: err });
//     }
//   };

const get_url_path = async (req, res) => {
  console.log(req.body.absent_date);

  let absentDates = req.body.absent_date;
  const student_id = req.body.student_id;
  const batch_name = req.body.batch_name;

  console.log(absentDates, batch_name);

  const videoRootDirectory = process.env.VIDEO_PATH;
  console.log(videoRootDirectory, "videoRootDirectory");

  const videoDirPath = path.resolve(videoRootDirectory, batch_name);
  console.log(videoDirPath, "videoDirPath");

  absentDates = absentDates.sort((a, b) => new Date(a) - new Date(b));
  
  try {
    const currentDate = new Date();
    absentDates = absentDates.filter(absentDate => {
      const dateDiff = Math.abs(currentDate - new Date(absentDate));
      const daysDiff = dateDiff / (1000 * 60 * 60 * 24);
      return daysDiff <= 30;
    });

    if (absentDates.length === 0) {
      return res
        .status(400)
        .json({ message: "No valid absent dates found within 30 days." });
    }

    const files = await fs.promises.readdir(videoDirPath);

    const result = {};

    for (const [index, absent_date] of absentDates.entries()) {
      console.log(absent_date, "absentDate");
      let matchingFiles;

      if (index > 4) {
        const record = await AbsentRecord.findOne({
          where: { student_id, batch_name, absent_date, approved_status: true },
        });
        console.log(record);

        if (!record) {
          return res
            .status(404)
            .json({ message: `Record not approved for date: ${absent_date}` });
        }

        matchingFiles = files.filter(
          file => file.includes(absent_date) && file.endsWith(".webm")
        );
      } else {
        matchingFiles = files.filter(
          file => file.includes(absent_date) && file.endsWith(".webm")
        );
      }

      result[absent_date] = matchingFiles.map(file =>
        path.join(batch_name, file)
      );
    }

    const hasResults = Object.values(result).some(paths => paths.length > 0);
    if (!hasResults) {
      return res
        .status(404)
        .json({ message: "No videos found matching the given absent dates." });
    }

    res.json(result);
  } catch (err) {
    console.error("Error reading directory:", err);
    res.status(500).json({ error: "Internal Server Error", data: err });
  }
};

const video_request = async (req, res) => {
  try {
    const { student_id, batch_name, absent_date } = req.body;

    if (!student_id || !batch_name || !absent_date) {
        return res.status(400).json({ error: "Missing required fields." });
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
    const { student_id, user_role_id, batch_name, absent_date } = req.body;; 
    if (user_role_id == 1){

      const record = await AbsentRecord.findOne({
        where: { student_id , batch_name, absent_date},
       });
      if (!record) {
          return res.status(404).json({ message: "Record not found" });
      }
  
      record.approved_status = true;
      await record.save();
  
      return res.status(200).json({
          message: "Approved status updated successfully",
          record,
      });
    }
} catch (error) {
    console.error("Error updating approved status:", error);
    return res.status(500).json({ message: "Internal server error", error });
}
}

const test = async (req, res) => {
  
  return res
    .status(200)
    .json({ message: "welcome" });

};

module.exports = { test, stream, get_url_path, video_request, video_request_approve};

