const fs = require("fs");
const path = require("path");
const AbsentRecord = require("../models/absent_records");


// const stream = async (req, res) => {
//     const absentDate = req.query.absent_date; // Access 'absent_date'
//   const batchName = req.query.batch_name;   // Access 'batch_name'

//   console.log(absentDate, batchName);


//   const videoRootDirectory = process.env.VIDEO_PATH;
// //   const { batchName, absentDate } = req.params;
//   const videoPath = path.resolve(
//     videoRootDirectory,
//     batchName,
//     absentDate
//   ) + `+02_00.webm`;
//   console.log(videoPath,"dfd");

//   if (!fs.existsSync(videoPath)) {
//     return res.status(404).json({ message: "file not found" });
//   }
//   try {
//     const stat = await fs.promises.stat(videoPath);
//     if (!stat.isFile()) {
//       return res.status(404).json({ message: "file not found" });
//     }
//     res.setTimeout(30000, () => {
//       res.status(504).json({ message: "Request timed out" });
//     });

//     // Streaming starts
//     const readStream = fs.createReadStream(videoPath); 
//     readStream.on("open", () => { 
//       res.setHeader("Content-Type", "video/webm"); 
//       readStream.pipe(res); 
//     }); 

//     readStream.on("error", err => {
//       console.error("Error reading file:", err);
//       if (!res.headersSent) {
//         res
//           .status(500)
//           .json({ message: "Internal Server Error Stream failed" });
//       }
//     });

//     res.on("close", () => {
//       readStream.destroy();
//     });
//   } catch (err) {
//     console.error("Error:", err);
//     res.status(500).json({
//       error: "Internal Server Error",
//       data: err,
//       path: videoPath,
//     });
//   }
// };

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

const stream = async (req, res) => {
  console.log(req.body.absent_date);

  let absentDates = req.body.absent_date;
  const batchName = req.body.batch_name;

  console.log(absentDates, batchName);

  const videoRootDirectory = process.env.VIDEO_PATH;
  console.log(videoRootDirectory, "videoRootDirectory");

  const videoDirPath = path.resolve(videoRootDirectory, batchName);
  console.log(videoDirPath, "videoDirPath");

  try {
    if (absentDates.length > 5) {
      return res
        .status(400)
        .json({ message: "You can only pass up to 5 absent dates." });
    }

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

    absentDates.forEach(absentDate => {
      const matchingFiles = files.filter(
        file => file.includes(absentDate) && file.endsWith(".webm")
      );

      result[absentDate] = matchingFiles.map(file =>
        path.join(videoDirPath, file)
      );
    });

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

    console.log("Checking for existing record with student_id:", student_id);

    // Check if the student_id already exists
    const existingRecord = await AbsentRecord.findOne({
      where: { student_id },
    });

   
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to add or update absent record." });
  }
};



const video_request_approve = async (req, res) => {
  try {
    const { id, user_id } = req.params; 

    // if 
    const record = await AbsentRecord.findOne(id);

    if (!record) {
        return res.status(404).json({ message: "Record not found" });
    }

    record.approved_status = true;
    await record.save();

    return res.status(200).json({
        message: "Approved status updated successfully",
        record,
    });
} catch (error) {
    console.error("Error updating approved status:", error);
    return res.status(500).json({ message: "Internal server error", error });
}
}
module.exports = { stream, video_request, video_request_approve};

