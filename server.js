const express = require('express');
const router = require('./routes/router');
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