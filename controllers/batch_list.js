const fs = require("fs");
const path = require("path");
const AbsentRecord = require("../models/absent_records");
const { getVideoDurationInSeconds } = require('get-video-duration')

const stream2 = async (req, res) => {
    try {
        const range = req.headers.range;
        if (!range) {
            return res.status(400).send("Requires Range header");
        }

        let url_path2 = req.query.path.replace(/(\d{2}) (\d{2}:\d{2})/, '$1+$2');
        const videoPath = `/home/recorded-class-backend/public/videos/downloaded_videos/${req.query.batch}/${url_path2}`;

        if (!fs.existsSync(videoPath)) {
            return res.status(404).send("Video file not found");
        }

        const videoSize = fs.statSync(videoPath).size;
        console.log(videoSize, "Video size:", videoPath);

        const CHUNK_SIZE = 10 ** 7;
        const bytesPrefix = "bytes=";
        if (range.startsWith(bytesPrefix)) {
            const bytesRange = range.slice(bytesPrefix.length);
            const [startStr, endStr] = bytesRange.split("-");
            const start = parseInt(startStr, 10);
            const end = endStr ? parseInt(endStr, 10) : Math.min(start + CHUNK_SIZE, videoSize - 1);

            const contentLength = end - start + 1;
            const headers = {
                "Content-Range": `bytes ${start}-${end}/${videoSize}`,
                "Accept-Ranges": "bytes",
                "Content-Length": contentLength,
                "Content-Type": "video/webm", // Update to match your video format
            };

            res.writeHead(206, headers);
            const videoStream = fs.createReadStream(videoPath, { start, end });
            videoStream.pipe(res);
        } else {
            return res.status(400).send("Invalid Range header");
        }
    } catch (error) {
        console.error("Error streaming video:", error);
        res.status(500).send("Internal Server Error");
    }
};

const videoList = async (req, res) => {
    try {
        let files = [];
        console.log("Request Params:", req.query);
        let dir = `/home/recorded-class-backend/public/videos/downloaded_videos/${req.query.batch}`;
        const fileList = fs.readdirSync(dir);

        for (const file of fileList) {
            const name = file;
            const filePath = path.join(dir, file);

            try {
                const duration = await getVideoDurationInSeconds(filePath);
                const minutes = Math.floor(duration / 60);
                const remainingSeconds = Math.floor(duration % 60);
                const durationInMinutes = `${minutes} min ${remainingSeconds} sec`;

                files.push({ name: name, duration: durationInMinutes });
            } catch (err) {
                files.push({ name: name, duration: 0 });
                continue;
            }
        }

        if (files.length > 0) {
            res.json(files);
        } else {
            res.json({ "error": "No files found for this batch." });
        }
    } catch (error) {
        console.log("error", error);
        res.status(500).json({ "error": "Internal server error." });
    }
};


module.exports = { stream2, videoList };
