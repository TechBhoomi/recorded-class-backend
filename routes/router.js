
const express = require('express');
const { stream, test, get_url_path, get_url_path4 } = require('../controllers/stream');
const { stream2, videoList } = require('../controllers/batch_list');
const { video_request, video_request_approve, getRequests } = require('../controllers/video_request');
const { getVideoRoute } = require('../controllers/video_list');
const { getVideoFilesRoute, getDownloadStatusRoute } = require('../controllers/video_download')

const router = express.Router();
router.get("/home", test);

router.post("/video_request", video_request);
router.post("/video_request_approve", video_request_approve)
router.get("/get_request_lists", getRequests)

// 
router.get("/stream_video", stream2);

router.post('/get-videos', getVideoRoute);
router.post('/get-video-files', getVideoFilesRoute);
router.get('/get-video-status', getDownloadStatusRoute);
// const { runManualCleanup } = require('../helpers/cron');

// // Run a manual cleanup (useful for testing)
// runManualCleanup().then(() => {
//   console.log('Manual cleanup completed');  
// });
module.exports = router;

