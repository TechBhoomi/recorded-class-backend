const express = require('express');
const router = require('./routes/router');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());


app.use(cors({ origin: "*" }));

// Routes
app.use('/api/auth', router);
app.use((req, res, next) => {
    console.log(`Incoming Request Size: ${JSON.stringify(req.body).length} bytes`);
    next();
  });
  
app.listen(PORT, () => {
    console.log(`server running on port ` + PORT);
});
