const express = require('express');
const router = require('./routes/router');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(cors());

// Routes
app.use('/api/auth', router);

app.listen(PORT, () => {
    console.log(`server running on port ` + PORT);
});
