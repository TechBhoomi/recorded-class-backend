const fs = require("fs");
const path = require("path");
const { Op } = require('sequelize');
const AbsentRecord = require("../models/absent_records");
const { SortAndFilterDates, IsRequested } = require("../helpers/helper")
const { fetchVideoDetails } = require("../helpers/video_downloads")

const stream = async (req, res) => {
  let url_path2 = req.query.path.replace(/(\d{2}) (\d{2}:\d{2})/, '$1+$2');
  // console.log(url_path2);
  
  // let url_path = req.query.path.replace(" 02_00.", "+02_00.").replace(" 03_00.", "+03_00.");
  // const videoRootDirectory = process.env.VIDEO_PATH2;
  const videoRootDirectory = `/home/recorded-class-backend/public/videos/downloaded_videos/${req.query.batch}`;
  const videoPath = path.resolve(videoRootDirectory, url_path2);

  console.log("Video path:", videoPath);

  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ message: "File not found" });
  }

  try {
    const stat = await fs.promises.stat(videoPath);
    if (!stat.isFile()) {
      return res.status(404).json({ message: "File not found" });
    }

    const fileSize = stat.size;
    const range = req.headers.range;

    // Dynamically import the MIME package
    const mimeModule = await import("mime");
    const mime = mimeModule.default; // Access the default export
    const contentType = mime.getType(videoPath) || "application/octet-stream";

    if (!range) {
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": fileSize,
      });

      const readStream = fs.createReadStream(videoPath);
      readStream.pipe(res);

      readStream.on("error", (err) => {
        console.error("ReadStream error (full file):", err);
        if (!res.headersSent) {
          res.status(500).json({ message: "Streaming error" });
        }
      });

      res.on("close", () => readStream.destroy());
      return;
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.setHeader("Content-Range", `bytes */${fileSize}`);
      return res.status(416).send("Requested range not satisfiable");
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType,
    });

    const readStream = fs.createReadStream(videoPath, { start, end });
    readStream.pipe(res);

    readStream.on("error", (err) => {
      console.error("ReadStream error (partial content):", err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Streaming error" });
      }
    });

    res.on("close", () => readStream.destroy());
  } catch (err) {
    console.error("Streaming error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        message: "Internal Server Error",
        error: err.message,
      });
    }
  }
};

async function AbsentDateValidation(absentDates, student_id, batch_name, files) {
  // 
  const result = {};

  for (const [index, absent_date] of absentDates.entries()) {
    console.log(absent_date, "absentDate");
    console.log(index, "index");

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
        const { files: downloadedFiles , unavailableFiles: unavailableDate , error } = await fetchVideoDetails(batch_name, absent_date);

        console.log(downloadedFiles, unavailableDate,"ahssjdsbdsfsdjfsdfsdfsjkgfkh");
        result[absent_date] = downloadedFiles
      } else {
        result[absent_date] = matchingFiles
       
      }
    }

    console.log(absent_date, "absent_date");
  }

  return result; // Return the result object for further use
}

const test = async (req, res) => {

  return res
    .status(200)
    .json({ message: "welcome" });

};

const get_url_path4 = async (req, res) => {
  let { absent_date, student_id, batch_name } = req.body;
  const videoRootDirectory = process.env.VIDEO_PATH2;
  const videoDirPath = path.resolve(videoRootDirectory, batch_name);

  try {
    // Check if the directory exists
    await fs.promises.access(videoDirPath, fs.constants.R_OK);
  } catch (err) {
    console.error("Directory not found:", err);
    return res.status(404).json({ error: `Directory not found: ${batch_name}` });
  }

  // Process absent dates

  try {
    const files = await fs.promises.readdir(videoDirPath);
    console.log("Available Video Files:", files);

    const requestedData = await IsRequested(student_id, batch_name, absent_date);
    console.log(requestedData, "requestedData");
    let result = {};

    if (requestedData.requested_dates_length == 0) {
      console.log(absent_date,"6666666666666666666666666666");
      
      absent_date = SortAndFilterDates(absent_date);
      
      console.log(absent_date.map(date => {
        
      }),"absent_date");
      
      if (absent_date.length > 5) {
        absent_date = absent_date.slice(0, 5); // Keep only the first 5 elements
      }
      console.log(absent_date,"8888888888888");
      
      absent_date.map((date) => {
        const matchingFiles = files.filter(
          file => file.includes(date) && (file.endsWith(".webm") || file.endsWith(".mp4"))
        );
        console.log(matchingFiles,"matchingFiles00000000");
        
        if (matchingFiles.length > 0) {
          result[date] = matchingFiles.map((file) => path.join(batch_name, file));
        }

      })

    } else {

      const lastIndexes = new Map();
      requestedData.active_dates.forEach((date, index) => {
        lastIndexes.set(date, index);
      });

      // Iterate through the array and keep only the last occurrence
      const uniqueDates = requestedData.active_dates.filter((date, index) => lastIndexes.get(date) === index);

      console.log(uniqueDates);
      for (const date of uniqueDates) {
        const matchingFiles = files.filter(
          (file) => file.includes(date) && (file.endsWith(".webm") || file.endsWith(".mp4"))
        );

        if (matchingFiles.length > 0) {
          result[date] = matchingFiles.map((file) => path.join(batch_name, file));
        }


        // }
      }

    }
    console.log("Final Result:", result);
    if (Object.keys(result).length === 0) {
      console.log("No videos matched the given dates.");
      return res.status(404).json({ message: "No videos found for the given dates." });
    } else if (Object.keys(result).length > 5) {
      const lastFiveKeys = Object.keys(result).slice(-5); // Get the last 5 keys
      result = lastFiveKeys.reduce((obj, key) => {
        obj[key] = result[key]; // Build a new object with the last 5 keys
        return obj;
      }, {});
    }
    console.log("Final Result:", result);
    return res.json(result);
  } catch (err) {
    console.error("Error reading directory:", err);
    return res.status(500).json({ error: "Internal Server Error", data: err });
  }
};













module.exports = { test, stream, get_url_path4, AbsentDateValidation };

