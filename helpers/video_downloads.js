const fs = require("fs-extra");
const path = require("path");
const SftpClient = require("ssh2-sftp-client");
const EventEmitter = require('events');
EventEmitter.defaultMaxListeners = 20; // Increase the limit

const activeDownloadsMap = new Map();

const serverAConfig = {
  host: "92.204.168.59",
  user: "root",
  password: "uhMJ4WJmTFhF",
  port: 22,
  readyTimeout: 600000
};
const serverBConfig = {
  host: "106.51.80.18",
  user: "root",
  password: "legend@123",
  port: 8787,
};

const remoteDir = "/home/techreactive/var/www/html/videos/";
const localDir = "/home/recorded-class-backend/videos/downloaded_videos/";
// const uploadDir = "/home/recorded-class-backend/videos/downloaded_videos/";


async function connectSFTP(config, serverName) {
  const sftp = new SftpClient(); // Create a new instance for each connection
  let retries = 3;
  while (retries > 0) {
    try {
      await sftp.connect(config);
      console.log(`Successfully connected to ${serverName} (${config.host})`);
      return sftp; // Return the connected client
    } catch (error) {
      console.error(`Failed to connect to ${serverName} (${config.host}):`, error.message);
      retries--;
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retrying
    }
  }
  console.error(`Unable to connect to ${serverName} after multiple attempts.`);
  throw new Error(`Failed to connect to ${serverName}`);
}

// async function transferFiles(batch_name, date) {
//   const batchRemoteDir = path.join(String(remoteDir), String(batch_name));
//   const batchLocalDir = path.join(localDir, batch_name);

//   await fs.ensureDir(batchLocalDir);

//   let sftpA, sftpB;
//   try {
//     sftpA = await connectSFTP(serverAConfig, "Server A");
//     sftpB = await connectSFTP(serverBConfig, "Server B");

//     console.log(`Fetching file list from Server A: ${batchRemoteDir}`);
//     try {
//       const files = await sftpA.list(batchRemoteDir);
//       console.log(files, "files----");

//       const dateFiles = files.filter(file => file.name.includes(date) && (file.name.endsWith(".webm") || file.name.endsWith(".mp4")));

//       const downloadedFiles = [];
//       console.log(dateFiles, "dateFiles");

//       for (const file of dateFiles) {
//         const fileName = file.name;
//         const remoteFilePath = path.join(batchRemoteDir, fileName);
//         const localFilePath = path.join(batchLocalDir, fileName);

//         try {
//           console.log(`Downloading ${fileName} from Server A...`);
//           const downloadStart = Date.now(); // Start timing for this file
//           await sftpA.fastGet(remoteFilePath, localFilePath);
//           console.log(`Downloaded ${fileName}`);
//           const downloadEnd = Date.now();
//           console.log(`Downloaded ${fileName} (Time taken: ${(downloadEnd - downloadStart) / 1000} seconds)`);


//           downloadedFiles.push(fileName);
//           if(downloadedFiles.length > 0){
            
//           }
//         } catch (error) {
//           console.error(`Error transferring ${fileName}: ${error.message}`);
//         }
//       }

//       return { files: downloadedFiles, error: null };
//     } catch (error) {
//       // Log the specific error
//       console.error('Error listing SFTP directory:', error.message);
//       return { files: [], error: error.message };
//     }

//   } catch (error) {
//     console.error(`Error processing batch ${batch_name} for ${date}: ${error.message}`);
//     return { files: [], error: error.message };
//   } finally {
//     console.log("Closing SFTP connections...");
//     if (sftpA) await sftpA.end();
//     if (sftpB) await sftpB.end();
//   }
// }

// const get_url_path5 = async (req, res) => {
//   const { absent_date, batch_name } = req.body;

//   console.log(`API Request: batch=${batch_name}, dates=${absent_date.join(", ")}`);

//   const isDownloading = absent_date.some(date => activeDownloadsMap.has(`${batch_name}_${date}`));
//   if (isDownloading) {
//     return res.json({ message: "File is still downloading, please wait...", result: [] });
//   }

//   const videoRootDirectory = process.env.VIDEO_PATH2;
//   const videoDirPath = path.resolve(videoRootDirectory, batch_name);
//   try {
//     await fs.promises.access(videoDirPath, fs.constants.R_OK);
//   } catch {
//     await fs.promises.mkdir(videoDirPath, { recursive: true });
//   }

//   let result = {};

//   try {
//     await fs.ensureDir(videoDirPath);
//     const localFiles = await fs.readdir(videoDirPath);
//     console.log(videoDirPath);
//     console.log( absent_date.filter(date => {
//       !localFiles.filter(
//         file => {
//           console.log(file,"ghh ");
          
//           file.includes(date)

//         })
      
//       console.log(date);
//     }));

//     const missingDates = absent_date.filter(date => 
//       !localFiles.some(file => file.includes(date))
//     );
// console.log(missingDates);

//     console.log(`Missing dates found: ${missingDates.join(", ")}`);

//     for (const date of missingDates) {
//       const key = `${batch_name}_${date}`;
//       activeDownloadsMap.set(key, true);

//       try {
//         const { files: downloadedFiles, error } = await transferFiles(batch_name, date);
//         activeDownloadsMap.delete(key);

//         if (error) {
//           console.error(`Error in transfer for ${date}: ${error}`);
//           return res.status(500).json({ message: "Batch not found" });
//         } else if (downloadedFiles.length) {
//           result[date] = downloadedFiles.map(file => path.join(batch_name, file));
//         }
//       } catch (error) {
//         console.error(`Unexpected error in transfer for ${date}: ${error.message}`);
//         activeDownloadsMap.delete(key);
//       }
//     }

//     return res.json({ message: "File download started, check back later.", result: [] });
//   } catch (err) {
//     console.error("Error handling files:", err);
//     return res.status(500).json({ message: "Internal Server Error", data: err });
//   }
// };
// const checkActiveDownloads = async (req, res) => {
//   if (activeDownloadsMap.size === 0) {
//     return res.json({ message: "No files are currently being downloaded.", activeDownloads: [] });
//   }

//   const activeDownloads = Array.from(activeDownloadsMap.keys());
//   return res.json({ message: "Files are still downloading.", activeDownloads });
// };




async function transferFiles(batch_name, date) { 
  const batchRemoteDir = path.join(String(remoteDir), String(batch_name));
  const batchLocalDir = path.join(localDir, batch_name);

  await fs.ensureDir(batchLocalDir);

  let sftpA, sftpB;
  try {
    sftpA = await connectSFTP(serverAConfig, "Server A");
    sftpB = await connectSFTP(serverBConfig, "Server B");

    console.log(`Fetching file list from Server A: ${batchRemoteDir}`);

    try {
      const files = await sftpA.list(batchRemoteDir);
      // console.log(files, "files-- --");

      const dateFiles = files.filter(file => file.name.includes(date) && (file.name.endsWith(".webm") || file.name.endsWith(".mp4")));
      const unavailableDates = []
      const downloadedFiles = [];
      console.log(dateFiles, "dateFiles");
      if (dateFiles.length == 0) {
        unavailableDates.push(date);
      }
      for (const file of dateFiles) {
        const fileName = file.name;
        const remoteFilePath = path.join(batchRemoteDir, fileName);
        const localFilePath = path.join(batchLocalDir, fileName);

        try {
          console.log(`Downloading ${fileName} from Server A...`);
          const downloadStart = Date.now(); 
          await sftpA.fastGet(remoteFilePath, localFilePath);
          const downloadEnd = Date.now();
          console.log(`Downloaded ${fileName} (Time taken: ${(downloadEnd - downloadStart) / 1000} seconds)`);

          downloadedFiles.push(fileName);
        } catch (error) {
          console.error(`Error transferring ${fileName}: ${error.message}`);
        }
      }

      return { files: downloadedFiles, unavailableFiles: unavailableDates, error: null };
    } catch (error) {
      console.error('Error listing SFTP directory:', error.message);
      return { files: [], unavailableFiles:[], error: error.message };
    }

  } catch (error) {
    console.error(`Error processing batch ${batch_name} for ${date}: ${error.message}`);
    return { files: [], unavailableFiles: [], error: error.message };
  } finally {
    console.log("Closing SFTP connections...");
    if (sftpA) await sftpA.end();
    if (sftpB) await sftpB.end();
  }
}

const get_url_path5 = async (req, res) => {
  const { absent_date, batch_name } = req.body;

  console.log(`API Request: batch=${batch_name}, dates=${absent_date.join(", ")}`);

  // Check if any requested dates are already downloading
  const isDownloading = absent_date.some(date => activeDownloadsMap.has(`${batch_name}_${date}`));
  if (isDownloading) {
    return res.json({ message: "File is still downloading, please wait...", result: [] });
  }

  const videoRootDirectory = process.env.VIDEO_PATH2;
  const videoDirPath = path.resolve(videoRootDirectory, batch_name);

  try {
    await fs.ensureDir(videoDirPath);
    const localFiles = await fs.readdir(videoDirPath);

    const missingDates = absent_date.filter(date => 
      !localFiles.some(file => file.includes(date))
    );

    console.log(`Missing dates found: ${missingDates.join(", ")}`);

    if (missingDates.length === 0) {
      return res.json({ message: "All files are available.", result: [] });
    }

    // Add all missing dates to activeDownloadsMap
    for (const date of missingDates) {
      const key = `${batch_name}_${date}`;
      activeDownloadsMap.set(key, true);
    }

    // Immediately respond to API request
    res.json({ message: "File download started, check back later.", result: [] });

    // Start downloads in the background
    await Promise.all(missingDates.map(async (date) => {
      const key = `${batch_name}_${date}`;
      try {
        const { files: downloadedFiles, unavailableFiles: unavailableDates , error } = await transferFiles(batch_name, date);
        if (unavailableDates.length > 0) {
        //  return res.status(200).json({ message: `Video deoes not exists ${date}`, result: [], unavailableDates: unavailableDates });
        }else if (error) {
          console.error(`Error in transfer for ${date}: ${error}`);
        } else if (downloadedFiles.length) {
          console.log(`Downloaded files for ${date}:`, downloadedFiles);
        } else {
          res.json({ message: "File download started, check back later.", result: [], unavailableDates:[] });
        }
      } catch (error) {
        console.error(`Unexpected error in transfer for ${date}: ${error.message}`);
      } finally {
        activeDownloadsMap.delete(key);
      }
    }));

  } catch (err) {
    console.error("Error handling files:", err);
    return res.status(500).json({ message: "Internal Server Error", result: err });
  }
};

const checkActiveDownloads = async (req, res) => {
  if (activeDownloadsMap.size === 0) {
    return res.json({ message: "No files are currently being downloaded.", activeDownloads: [] });
  }

  const activeDownloads = Array.from(activeDownloadsMap.keys());
  return res.json({ message: "Files are still downloading.", activeDownloads });
};

async function fetchVideoDetails(batch_name, date) {
  const batchRemoteDir = path.join(String(remoteDir), String(batch_name));
  const batchLocalDir = path.join(localDir, batch_name);

  await fs.ensureDir(batchLocalDir);

  let sftpA
  try {
    sftpA = await connectSFTP(serverAConfig, "Server A");

    console.log(`Fetching file list from Server A: ${batchRemoteDir}`);
    try {
      const files = await sftpA.list(batchRemoteDir);
      console.log(files, "files----");

      const dateFiles = files.filter(file => file.name.includes(date) && (file.name.endsWith(".webm") || file.name.endsWith(".mp4")));

      const downloadedFiles = [];
      console.log(dateFiles, "dateFiles");


      return dateFiles
    } catch (error) {
      // Log the specific error
      console.error('Error listing SFTP directory:', error.message);
      return []
    }

  } catch (error) {
    console.error(`Error processing batch ${batch_name} for ${date}: ${error.message}`);
    return [];
  } finally {
    console.log("Closing SFTP connections...");
    if (sftpA) await sftpA.end();
  }
}
module.exports = { transferFiles,fetchVideoDetails, get_url_path5, checkActiveDownloads };