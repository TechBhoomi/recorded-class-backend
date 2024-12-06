const express = require('express');
const router = require('./routes/router');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.use('/api/auth', router);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});