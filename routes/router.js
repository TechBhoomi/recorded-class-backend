
const express = require('express');
const { stream, video_request } = require('../controllers/stream');

const router = express.Router();

router.post("/video", stream);
router.post("/video_request", video_request);
module.exports = router;