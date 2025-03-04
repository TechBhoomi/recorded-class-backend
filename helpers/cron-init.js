// cron-init.js
const { setupCleanupCron } = require('./cron');

// Start the cleanup cron job
setupCleanupCron();

console.log('All cron jobs initialized successfully');