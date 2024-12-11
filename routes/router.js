
const express = require('express');
const { stream, video_request, video_request_approve, test, get_url_path } = require('../controllers/stream');

const router = express.Router();
router.get("/", test);
router.get("/stream_video", stream);
router.post("/video", get_url_path);
router.post("/video_request", video_request);
router.post("/video_request_approve",video_request_approve)
module.exports = router;