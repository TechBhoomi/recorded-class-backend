const fs = require("fs");
const path = require("path");
const { Op } = require('sequelize'); 
const AbsentRecord = require("../models/absent_records");


  const stream = async (req, res) => {
    let url_path = req.query.path.replace(" 02_00.", "+02_00.");
    const videoRootDirectory = process.env.VIDEO_PATH;
    const videoPath = path.resolve(videoRootDirectory, url_path);

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


const get_url_path2 = async (req, res) => {
  let absentDates = req.body.absent_date;
  const student_id = req.body.student_id;
  const batch_name = req.body.batch_name;
  const videoRootDirectory = process.env.VIDEO_PATH;
  const videoDirPath = path.resolve(videoRootDirectory, batch_name);
  try {
    await fs.promises.access(videoDirPath, fs.constants.R_OK);
  } catch (err) {
    console.error(`Directory does not exist or is not accessible: ${videoDirPath}`, err);
    return res
      .status(404)
      .json({ error: `Directory not found: ${batch_name}`
        // , details: err.message 
      });
  }
  // absentDates = absentDates.sort((a, b) => new Date(a) - new Date(b));

  absentDates = absentDates
  .map(date => new Date(date).toISOString().split('T')[0]) // Normalize dates to YYYY-MM-DD
  .filter((date, index, self) => self.indexOf(date) === index) // Remove duplicates
  // .sort((a, b) => new Date(a) - new Date(b)); // Sort dates
  
 
   
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

    result = await AbsentDateValidation(absentDates, student_id, batch_name, files);

    const hasResults = Object.values(result).some(paths => paths.length > 0);
    if (!hasResults) {
      return res
        .status(404)
        .json({ message: "No videos found matching the given absent dates." });
    }
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

const IsReqested = async (student_id, batch_name) =>{
  console.log("hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh");
  
  const existingRecord = await AbsentRecord.findAll({
    where: { student_id ,batch_name, approved_status: true,updatedAt: {
      [Op.gte]: new Date(new Date() - 30 * 24 * 60 * 60 * 1000), // Calculate date 30 days ago
    }},
    order: [    // Sort by 'is_active' first (descending)
      ['id', 'ASC'],     // Then sort by 'createdAt' (ascending)
    ],
   });
   let active_dates = []
   let requested_dates = []
   console.log(existingRecord.length);
   
   if (existingRecord.length > 0){
    console.log("dfsfs");
    
    existingRecord.map((ele)=>{
      console.log(ele.id,"ele.id");
      console.log(ele.video_details.active_video_dates,"existing rec");
      active_dates = ele.video_details.active_video_dates
      const updatedArr = requested_dates.push(ele.video_details.requested_video_date)
      console.log(active_dates,"activer dates");
      console.log(requested_dates,"requested_dates");
    })
   }else{
    console.log("ghfghg");
    console.log(active_dates);
    // active_dates = ele.video_details.active_video_dates
    // const updatedArr = requested_dates.push(ele.video_details.requested_video_date)
    return { active_dates, requested_dates_length: active_dates.length }
   }
   active_dates = active_dates.concat(requested_dates)
   console.log(active_dates);
   
  return  { active_dates, requested_dates_length: requested_dates.length }
}

async function AbsentDateValidation(absentDates, student_id, batch_name, files) {
  // 
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
// to sort and order dates
const sortAndOrderDates = async (absentDates) => {
  console.log(absentDates);
  
  absentDates = absentDates.map(date => new Date(date).toISOString().split('T')[0]) // Normalize dates to YYYY-MM-DD
  .filter((date, index, self) => self.indexOf(date) === index) // Remove duplicates
  // .sort((a, b) => new Date(a) - new Date(b)); // Sort dates
  return absentDates;
};
// to skip future dates
const skipFutureDates = async (absentDates) => {
  const currentDate = new Date();
  absentDates = absentDates.filter(absentDate => {
    const dateObj = new Date(absentDate);
    if (dateObj > currentDate) {
      console.log(`Skipping future date: ${absentDate}`);
      return false;
    }
    const dateDiff = Math.abs(currentDate - dateObj);
    console.log(dateDiff);
    
    const daysDiff = dateDiff / (1000 * 60 * 60 * 24);
    console.log(dateDiff,"dateDiff");
    
    return daysDiff <= 30;
  });
  return absentDates;
};


const get_url_path = async (req, res) => {
  let { absent_date,student_id, batch_name } = req.body 
  const videoRootDirectory = process.env.VIDEO_PATH;
  const videoDirPath = path.resolve(videoRootDirectory, batch_name);
  try {
    await fs.promises.access(videoDirPath, fs.constants.R_OK);
  } catch (err) {
    return res.status(404).json({ error: `Directory not found: ${batch_name}`});
  }


absent_date = await sortAndOrderDates(absent_date);
  
  try {
    absent_date = await skipFutureDates(absent_date);
    console.log(absent_date,"after sorting and skipping future dates");
    if (absent_date.length === 0) {
      return res
        .status(400)
        .json({ message: "No valid absent dates found within 30 days." });
    }

    const files = await fs.promises.readdir(videoDirPath);

    let result = {};
    console.log(absent_date.length,"absent length");
    let requestedDatesApended
     if (absent_date.length < 4){
        console.log("absent length is < 5");
        absent_date.map((date)=>{
          const matchingFiles = files.filter(
            file => file.includes(date) && (file.endsWith(".webm") || file.endsWith(".mp4"))
          );
            if (!matchingFiles || matchingFiles.length === 0) {
              console.log(`No matching files found for absent date: ${date}`);
              // return res.status(404).json({ message: `No matching files found for absent date: ${absent_date}` });
            } else {
              result[date] = matchingFiles.map(file =>
                path.join(batch_name, file)
              );
            }
        })
      
        // res.json(result)
      }else{
      requestedDatesApended = await IsReqested(student_id, batch_name)
      if (requestedDatesApended.active_dates.length > 0){
        for (const [index, absent_date] of requestedDatesApended.active_dates.entries()) {
          console.log(absent_date, "absentDate");
        
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
      }else{
        if (absent_date.length > 5) {
          absent_date = absent_date.slice(0, 5); // Keep only the first 5 elements
        }
        absent_date.map((date)=>{
          const matchingFiles = files.filter(
            file => file.includes(date) && (file.endsWith(".webm") || file.endsWith(".mp4"))
          );
            if (!matchingFiles || matchingFiles.length === 0) {
              console.log(`No matching files found for absent date: ${date}`);
              // Uncomment the following line if this is part of an Express.js route
              // return res.status(404).json({ message: `No matching files found for absent date: ${absent_date}` });
            } else {
              console.log(result,"result");
              
              result[date] = matchingFiles.map(file =>
                path.join(batch_name, file)
              );
            }
        })
      }
      }

    const hasResults = Object.values(result).some(paths => paths.length > 0);
    if (!hasResults) {
      return res
        .status(404)
        .json({ message: "No videos found matching the given absent dates." });
    }
    console.log(Object.keys(result),"bject.values(result).length");
    
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
    console.log(result,"result99999");
    
    res.json(result);
  } catch (err) {
    console.error("Error reading directory:", err);
    res.status(500).json({ error: "Internal Server Error", data: err });
  }
};


const test = async (req, res) => {
  
  return res
    .status(200)
    .json({ message: "welcome" });

};















module.exports = { test, stream, get_url_path, AbsentDateValidation};

