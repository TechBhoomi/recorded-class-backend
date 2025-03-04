// const fs = require("fs-extra");
// const path = require("path");
// const SftpClient = require("ssh2-sftp-client");
// const EventEmitter = require('events');
// const { SortAndFilterDates, IsRequested } = require("../helpers/helper")
// const axios = require("axios");

// const activeDownloadsMap = new Map();

// const serverAConfig = {
//   host: "92.204.168.59",
//   user: "root",
//   // password: "uhMJ4WJmTFhF",
//   port: 22,
//   readyTimeout: 600000
// };
// const serverBConfig = {
//   host: "106.51.80.18",
//   user: "root",
//   password: "legend@123",
//   port: 8787,
// };

// const remoteDir = "/home/techreactive/var/www/html/videos/";
// const localDir = "/home/recorded-class-backend/public/videos/downloaded_videos/";

// async function connectSFTP(config, serverName) {
//   const sftp = new SftpClient(); // Create a new instance for each connection
//   let retries = 3;
//   while (retries > 0) {
//     try {
//       await sftp.connect(config);
//       console.log(`Successfully connected to ${serverName} (${config.host})`);
//       return sftp; // Return the connected client
//     } catch (error) {
//       console.error(`Failed to connect to ${serverName} (${config.host}):`, error.message);
//       retries--;
//       await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retrying
//     }
//   }
//   console.error(`Unable to connect to ${serverName} after multiple attempts.`);
//   throw new Error(`Failed to connect to ${serverName}`);
// }

// // const fetchVideoDetails = async (req, res) => {
// //     const batchRemoteDir = path.join(String(remoteDir), String(req.query.batch));
// //     const batchLocalDir = path.join(localDir, req.query.batch);

// //     // Ensure the local directory exists
// //     await fs.ensureDir(batchLocalDir);

// //     let sftpA;
// //     try {
// //         // Connect to SFTP server
// //         sftpA = await connectSFTP(serverAConfig, "Server A");
// //         console.log(`Fetching file list from Server A: ${batchRemoteDir}`);

// //         // List files in the remote directory
// //         const files = await sftpA.list(batchRemoteDir);

// //         const unavailableDates = [];
// //         const allFiles = [];

// //         // Filter files based on the date query parameter
// //         if (req.query.date) {
// //             const dateFiles = files.filter(file => file.name.includes(req.query.date));
// //             if (dateFiles.length === 0) {
// //                 unavailableDates.push(req.query.date);
// //             }
// //             else {
// //                 allFiles.push(...files.map(file => file.name));
// //             }
// //         } else {
// //             allFiles.push(...files.map(file => file.name));
// //         }

// //         // Send the response
// //         res.json({ allFiles, unavailableDates, error: null });
// //     } catch (error) {
// //         console.error('Error fetching video details:', error.message);
// //         res.status(500).json({ allFiles: [], unavailableDates: [], error: error.message });
// //     } finally {
// //         // Close the SFTP connection
// //         console.log("Closing SFTP connections...");
// //         if (sftpA) await sftpA.end();
// //     }
// // };
// // function removeValues(arr1, arr2) {
// //     return arr1.filter(value => !arr2.includes(value));
// // }

// // const videoList = async (req, res) => {
// //   let { absent_date, student_id, batch_name } = req.body;
// //   const videoRootDirectory = process.env.VIDEO_PATH2;
// //   const videoDirPath = path.resolve(videoRootDirectory, batch_name);

// //   // const isDownloading = absent_date.some(date => activeDownloadsMap.has(`${batch_name}_${date}`));
// //   // if (isDownloading) {
// //   //   return res.json({ message: "File is still downloading, please wait...", result: [] });
// //   // }

// //   try {
// //     await fs.ensureDir(videoDirPath);
// //     const files = await fs.promises.readdir(videoDirPath);
// //     const requestedData = await IsRequested(student_id, batch_name, absent_date);
// //     let result = {};
// //     absent_date = SortAndFilterDates(absent_date);

// //     const missingDates = absent_date.filter(date => 
// //       !files.some(file => file.includes(date))
// //     );

// //     console.log(missingDates,"dates of sorted array , files not in local ");
    

// //     for (const date of missingDates) {
// //       const key = `${batch_name}_${date}`;
// //       activeDownloadsMap.set(key, true);
// //     }

// //     console.log(absent_date,"qqqqqqqqqqqqqqqqqqqqqqqqq");
    
// //     if (requestedData.requested_dates_length == 0) {
// //       if (absent_date.length > 5) {
// //         absent_date = absent_date.slice(0, 5);
// //       }

// //       for (const date of absent_date) {
// //         let key = `${batch_name}_${date}`;
// //         const matchingFiles = files.filter(
// //           file => file.includes(date) && (file.endsWith(".webm") || file.endsWith(".mp4"))
// //         );
// //         if (matchingFiles.length > 0) {
// //           result[date] = matchingFiles.map((file) => path.join(batch_name, file));
// //         } else {
// //           try {
// //             activeDownloadsMap.set(key, true);
// //             const { files: downloadedFiles = [], unavailableFiles: unavailableDates = [], error } =await transferFiles(batch_name, date);
// //             // await new Promise(resolve => setTimeout(resolve, 2000));
// //             // if (unavailableDates.length > 0) {
// //             //   console.log(`Unavailable files for ${date}:`, unavailableDates);
// //             // } else if (error) {
// //             //   console.error(`Error in transfer for ${date}: ${error}`);
// //             // } else if (downloadedFiles.length > 0) {
// //             //   console.log(`Downloaded files for ${date}:`, downloadedFiles);
// //             // } else {
// //               // return res.json({ message: "Fetching videos, please try later.", result: [], unavailableDates: [] });
// //             // }
// //           } catch (error) {
// //             console.error(`Unexpected error in transfer for ${date}: ${error.message}`);
// //           } finally {
// //             activeDownloadsMap.delete(key);
// //           }
// //         }
// //       }
// //     }else {
    
// //           const lastIndexes = new Map();
// //           if (requestedData.active_dates < 5) {
// //             absent_date = absent_date.slice(0, 5);
// //           }
// //           requestedData.active_dates.forEach((date, index) => {

// //             lastIndexes.set(date, index);
// //           });
    
// //           // Iterate through the array and keep only the last occurrence
// //           let uniqueDates = requestedData.active_dates.filter((date, index) => lastIndexes.get(date) === index);
// //           uniqueDates = SortAndFilterDates(uniqueDates);
// //           console.log(uniqueDates,"iiiiiiiiiiiiiiiiii");
// //           absent_date = removeValues(absent_date, uniqueDates);
// //           console.log("remved dates",uniqueDates);
          
// //           uniqueDates = [...uniqueDates,...absent_date]
// //           console.log("ssssssssssss",uniqueDates);
// //           if (uniqueDates.length > 5) {
// //             uniqueDates = uniqueDates.slice(0, 5);
// //           }
// //           for (const date of uniqueDates) {
// //             let key = `${batch_name}_${date}`;
// //             const matchingFiles = files.filter(
// //               file => file.includes(date) && (file.endsWith(".webm") || file.endsWith(".mp4"))
// //             );
// //             if (matchingFiles.length > 0) {
// //               result[date] = matchingFiles.map((file) => path.join(batch_name, file));
// //             } else {
// //               try {
// //                 activeDownloadsMap.set(key, true);
// //                 const { files: downloadedFiles = [], unavailableFiles: unavailableDates = [], error } =await transferFiles(batch_name, date);
// //                 if (downloadedFiles.length > 0) {
// //                   console.log(`Downloaded files for ${date}:`, downloadedFiles);
// //                 } 
// //                 // else {
// //                   // return res.json({ message: "Fetching videos, please try later.", result: [], unavailableDates: [] });
// //                 // }
// //               } catch (error) {
// //                 console.error(`Unexpected error in transfer for ${date}: ${error.message}`);
// //               } finally {
// //                 activeDownloadsMap.delete(key);
// //               }
// //             }
// //           }
    
// //         }

// //     console.log("Final Result:", result);
// //     if (Object.keys(result).length === 0) {
// //       console.log("No videos matched the given dates.");
// //       return res.status(404).json({ message: "No videos found for the given dates." });
// //     } else if (Object.keys(result).length > 5) {
// //       const lastFiveKeys = Object.keys(result).slice(-5); // Get the last 5 keys
// //       result = lastFiveKeys.reduce((obj, key) => {
// //         obj[key] = result[key]; // Build a new object with the last 5 keys
// //         return obj;
// //       }, {});
// //     }
// //     console.log("Final Result:", result);
// //     return res.json(result);
// //   } catch (err) {
// //     console.error("Error reading directory:", err);
// //     return res.status(500).json({ error: "Internal Server Error", data: err });
// //   }
// // };

// module.exports = { removeValues, 
//   // fetchVideoDetails 
// };




