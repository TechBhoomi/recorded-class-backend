const fs = require("fs");
const path = require("path");
const AbsentRecord = require("../models/absent_records");


const stream = async (req, res) => {
    let url_path = req.query.path; 
if(url_path.includes("02_00.")){
  url_path = url_path.replace(" 02_00.", "+02_00.")
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
  // absentDates = absentDates.sort((a, b) => new Date(a) - new Date(b));
  absentDates = absentDates
  .map(date => new Date(date).toISOString().split('T')[0]) // Normalize dates to YYYY-MM-DD
  .filter((date, index, self) => self.indexOf(date) === index) // Remove duplicates
  .sort((a, b) => new Date(a) - new Date(b)); // Sort dates

console.log(absentDates);

  try {
    const currentDate = new Date();
    absentDates = absentDates.filter(absentDate => {
      const dateObj = new Date(absentDate);
      console.log(dateObj,"dateObj", currentDate);
      console.log(dateObj > currentDate);
      
      if (dateObj > currentDate) {
        console.log(`Skipping future date: ${absentDate}`);
        return false;
      }
      const dateDiff = Math.abs(currentDate - dateObj);
      const daysDiff = dateDiff / (1000 * 60 * 60 * 24);
      return daysDiff <= 30;
    });

    if (absentDates.length === 0) {
      return res
        .status(400)
        .json({ message: "No valid absent dates found within 30 days." });
    }

    const files = await fs.promises.readdir(videoDirPath);

    let result = {};

    result = await absentDateValidation(absentDates, student_id, batch_name, files);

    const hasResults = Object.values(result).some(paths => paths.length > 0);
    if (!hasResults) {
      return res
        .status(404)
        .json({ message: "No videos found matching the given absent dates." });
    }
console.log(Object.values(result).length);
if (Object.values(result).length > 5) {
  const keys = Object.keys(result);
  const removeCount = Object.values(result).length - 5; // How many to remove from the start
  for (let i = 0; i < removeCount; i++) {
    delete result[keys[i]]; // Remove the first few key-value pairs
  }

  // Add the last ones (the ones after the first `removeCount`)
  for (let i = removeCount; i < keys.length; i++) {
    result[keys[i]] = result[keys[i]]; // Ensure the last entries are kept
  }
}
    res.json(result);
  } catch (err) {
    console.error("Error reading directory:", err);
    res.status(500).json({ error: "Internal Server Error", data: err });
  }
};

async function AbsentDateValidation(absentDates, student_id, batch_name, files) {
  const result = {};

  for (const [index, absent_date] of absentDates.entries()) {
    console.log(absent_date, "absentDate");

    let record;
    if (index > 4) {
      record = await AbsentRecord.findOne({
        where: { student_id, batch_name, absent_date, approved_status: true },
      });
      console.log(record);
    }

    if (index <= 4 || record) {
      const matchingFiles = files.filter(
        file => file.includes(absent_date) && (file.endsWith(".webm") || file.endsWith(".mp4"))
      );

      if (!matchingFiles || matchingFiles.length === 0) {
        console.log(`No matching files found for absent date: ${absent_date}`);
        // Uncomment the following line if this is part of an Express.js route
        // return res.status(404).json({ message: `No matching files found for absent date: ${absent_date}` });
      } else {
        result[absent_date] = matchingFiles.map(file =>
          path.join(batch_name, file)
        );
      }
    }

    console.log(absent_date, "absent_date");
  }

  return result; // Return the result object for further use
}


// function absentDateValidation(absentDates) {
//   for (const [index, absent_date] of absentDates.entries()) {
//     console.log(absent_date, "absentDate");
//     let matchingFiles;

//     if (index > 4) {
//       const record = await AbsentRecord.findOne({
//         where: { student_id, batch_name, absent_date, approved_status: true },
//       });
//       console.log(record);

//       if (record) {
//         matchingFiles = files.filter(
//           file => file.includes(absent_date) && (file.endsWith(".webm") || file.endsWith(".mp4"))
//         );
//         console.log(matchingFiles,"matfinere");
//       }
//     } else {
//       matchingFiles = files.filter(
//         file => file.includes(absent_date) && (file.endsWith(".webm") || file.endsWith(".mp4"))
//       );
//     }
//     if (!matchingFiles || matchingFiles.length === 0) {
//       // return res
//       //   .status(404)
//       //   .json({ message: `No matching files found for absent date: ${absent_date}` });
//     }else{
//       result[absent_date] = matchingFiles.map(file =>
//         path.join(batch_name, file)
//       );
//     }
//     console.log(absent_date,"absent_date");
    
   
//   }
// }

const test = async (req, res) => {
  
  return res
    .status(200)
    .json({ message: "welcome" });

};

module.exports = { test, stream, get_url_path, AbsentDateValidation};

