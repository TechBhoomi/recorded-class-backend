const express = require('express');
const router = require('./routes/router');
const fs = require("fs");
const path = require("path");
const cors = require('cors');
require('dotenv').config();
require('./helpers/cron-init');



const app = express();
const PORT = process.env.PORT || 3000;

// app.use(express.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());


// scheduledTask.start();
// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: "error",
    message: "Internal server error",
    error: err.message,
  });
});

// Routes
app.use('/api/auth', router);
function isOlderThan6Months(dateStr) {
    try {
        const cleaned = dateStr.replace(/_/g, ":"); // Replace underscores with colons
        const videoDate = new Date(cleaned);
        if (isNaN(videoDate)) return false;

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        return videoDate < sixMonthsAgo; 
    } catch {
        return false;
    }
}

function findOldVideos(dirPath, baseUrl = "") {
    let results = [];

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (let item of items) {
        const fullPath = path.join(dirPath, item.name);
        const relativePath = path.join(baseUrl, item.name);

        if (item.isDirectory()) {
            results = results.concat(findOldVideos(fullPath, relativePath));
        } else {
            const nameWithoutExt = path.parse(item.name).name;
           if (isOlderThan6Months(nameWithoutExt)) {
    results.push({
        name: item.name,
        path: `/public/${relativePath.replace(/\\/g, "/")}`,
    });
}
        }
    }

    return results;
}

app.get("/fetch_old_videos", function (req, res) {
    console.log("Fetching videos...");

    const publicDir = path.join(__dirname, "public");
    const videos = findOldVideos(publicDir);

    res.json({
        count: videos.length,
        status: "success",
        message: "Videos fetched successfully",
        data: videos
    });
});
function deleteOldVideos(dirPath) {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (let item of items) {
        const fullPath = path.join(dirPath, item.name);

        if (item.isDirectory()) {
            deleteOldVideos(fullPath); // recurse into subdirectories
        } else {
            const nameWithoutExt = path.parse(item.name).name;

            if (isOlderThan6Months(nameWithoutExt)) {
                try {
                    fs.unlinkSync(fullPath); // delete file
                    console.log(`Deleted: ${fullPath}`);
                } catch (err) {
                    console.error(`Failed to delete ${fullPath}:`, err);
                }
            }
        }
    }
}

app.get("/delete_old_videos", function (req, res) {
    console.log("Deleting old videos...");

    const publicDir = path.join(__dirname, "public");
    deleteOldVideos(publicDir);

    res.json({
        status: "success",
        message: "Old videos deleted successfully"
    });
});

app.use((req, res, next) => {
    console.log(`Incoming Request Size: ${JSON.stringify(req.body).length} bytes`);
    next();
});
  
const server = app.listen(PORT, () => {
  console.log(`server running on port ` + PORT);
});
server.setTimeout(10 * 60 * 1000);
// app.listen(PORT, () => {
//     console.log(`server running on port ` + PORT);
// });
// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});