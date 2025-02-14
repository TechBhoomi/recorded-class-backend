
const express = require('express');
const { stream, test, get_url_path, get_url_path4 } = require('../controllers/stream');
const { video_request, video_request_approve, getRequests } = require('../controllers/video_request');
const {transferFiles, get_url_path5 ,checkActiveDownloads} = require('../helper/video_downloads')

const router = express.Router();
router.get("/home", test);
router.get("/stream_video", stream);
router.post("/video", get_url_path4);
router.post("/video2", get_url_path5);
router.post("/video_request", video_request);
router.post("/video_request_approve",video_request_approve)
router.get("/get_request_lists",getRequests)
// router.get("/download",transferFiles)
router.post("/status",checkActiveDownloads)
module.exports = router;

