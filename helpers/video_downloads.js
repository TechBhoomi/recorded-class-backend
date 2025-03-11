const fs = require("fs-extra");
const path = require("path");
const SftpClient = require("ssh2-sftp-client");
const EventEmitter = require('events');
const { SortAndFilterDates, IsRequested } = require("../helpers/helper")


EventEmitter.defaultMaxListeners = 20; 

const recordServerConfig = {
  host: "85.195.120.67",
  user: "root",
  password: "mGMXRsMTBxW7",
  port: 22,
  readyTimeout: 600000
};

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
const recordServerDir = "/var/www/html/node_recorder/videos";
const remoteDir = "/home/techreactive/var/www/html/videos/";
const localDir = "/home/recorded-class-backend/public/videos/downloaded_videos";


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



const activeDownloads = new Map();

async function transferFiles(batch_name, date) {
  const batchRemoteDir = path.join(String(recordServerDir), String(batch_name));
  const batchLocalDir = path.join(localDir, batch_name);

  // Create a unique key for this batch and date combination
  const downloadKey = `${batch_name}_${date}`;

  // Check if download is already in progress
  if (activeDownloads.has(downloadKey)) {
    console.log(`Download already in progress for ${batch_name} on ${date}`);
    return {
      files: [],
      unavailableFiles: [],
      error: "Download already in progress",
      status: "in_progress"
    };
  }

  await fs.ensureDir(batchLocalDir);

  let sftpA, sftpB;
  try {
    // Mark this download as active
    activeDownloads.set(downloadKey, new Date());

    sftpA = await connectSFTP(recordServerConfig, "Server A");
    sftpB = await connectSFTP(serverBConfig, "Server B");

    console.log(`Fetching file list from Server A: ${batchRemoteDir}`);

    try {
      const files = await sftpA.list(batchRemoteDir);
      const dateFiles = files.filter(file =>
        file.name.includes(date) &&
        (file.name.endsWith(".webm") || file.name.endsWith(".mp4"))
      );

      const unavailableDates = [];
      const downloadedFiles = [];

      if (dateFiles.length === 0) {
        unavailableDates.push(date);
      }

      for (const file of dateFiles) {
        const fileName = file.name;
        const remoteFilePath = path.join(batchRemoteDir, fileName);
        const localFilePath = path.join(batchLocalDir, fileName);

        // Check if file already exists locally
        try {
          const stats = await fs.promises.stat(localFilePath);
          if (stats.size === file.size) {
            console.log(`File ${fileName} already exists locally with correct size, skipping...`);
            downloadedFiles.push(fileName);
            continue;
          }
        } catch (err) {
          // File doesn't exist, proceed with download
        }

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

      return {
        files: downloadedFiles || [],
        unavailableFiles: unavailableDates || [],
        error: null,
        status: "completed"
      };

    } catch (error) {
      console.error('Error listing SFTP directory:', error.message);
      return {
        files: [],
        unavailableFiles: [],
        error: error.message,
        status: "error"
      };
    }

  } catch (error) {
    console.error(`Error processing batch ${batch_name} for ${date}: ${error.message}`);
    return {
      files: [],
      unavailableFiles: [],
      error: error.message,
      status: "error"
    };
  } finally {
    console.log("Closing SFTP connections...");
    if (sftpA) await sftpA.end();
    if (sftpB) await sftpB.end();

    // Remove the download from active downloads
    activeDownloads.delete(downloadKey);
  }
}

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
      const dateFiles = files.filter(file => 
       file.name.includes(date));

      const unavailableDates = []
      const downloadedFiles = [];
      if (dateFiles.length == 0) {
        unavailableDates.push(date);
      }else{
        downloadedFiles.push(date)
      }
console.log(downloadedFiles,"downloadedFiles");

      return { files: downloadedFiles || [], unavailableFiles: unavailableDates || [], error: null };
    } catch (error) {
      // Log the specific error
      console.error('Error listing SFTP directory:', error.message);
      return { files: [], unavailableFiles: [], error: error.message };
    }

  } catch (error) {
    console.error(`Error processing batch ${batch_name} for ${date}: ${error.message}`);
    return { files: [], unavailableFiles: [], error: error.message };
  } finally {
    console.log("Closing SFTP connections...");
    if (sftpA) await sftpA.end();
  }
}
async function fetchVideoDetails_RecordServer(batch_name, date) {
  const batchRemoteDir = path.join(String(recordServerDir), String(batch_name));
  const batchLocalDir = path.join(localDir, batch_name);

  await fs.ensureDir(batchLocalDir);

  let sftpA
  try {
    sftpA = await connectSFTP(recordServerConfig, "Server A");
    console.log(`Fetching file list from Server A: ${batchRemoteDir}`);
    try {
      const files = await sftpA.list(batchRemoteDir);
      const dateFiles = files.filter(file => 
       file.name.includes(date));

      const unavailableDates = []
      const downloadedFiles = [];
      if (dateFiles.length == 0) {
        unavailableDates.push(date);
      }else{
        downloadedFiles.push(date)
      }
      console.log(downloadedFiles,"downloadedFiles");

      return { files: downloadedFiles || [], unavailableFiles: unavailableDates || [], error: null };
    } catch (error) {
      // Log the specific error
      console.error('Error listing SFTP directory:', error.message);
      return { files: [], unavailableFiles: [], error: error.message };
    }

  } catch (error) {
    console.error(`Error processing batch ${batch_name} for ${date}: ${error.message}`);
    return { files: [], unavailableFiles: [], error: error.message };
  } finally {
    console.log("Closing SFTP connections...");
    if (sftpA) await sftpA.end();
  }
}
module.exports = { serverAConfig,connectSFTP,transferFiles, fetchVideoDetails,fetchVideoDetails_RecordServer,recordServerConfig, checkActiveDownloads };