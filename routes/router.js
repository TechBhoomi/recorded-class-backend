
const express = require('express');
const { stream, video_request, video_request_approve } = require('../controllers/stream');

const router = express.Router();

router.post("/video", stream);
router.post("/video_request", video_request);
router.put("/video_request_approve",video_request_approve)
module.exports = router;