
const express = require('express');
const { stream, test, get_url_path } = require('../controllers/stream');
const { video_request, video_request_approve, getRequests } = require('../controllers/video_request');

const router = express.Router();
router.get("/", test);
router.get("/stream_video", stream);
router.post("/video", get_url_path);
router.post("/video_request", video_request);
router.post("/video_request_approve",video_request_approve)
router.get("/get_request_lists",getRequests)
module.exports = router;