const { Sequelize } = require("sequelize");

// Configure Sequelize to connect to your PostgreSQL database
const sequelize = new Sequelize("recorded_classes", "rc_user", "rc@123", {
    host: "localhost",
    dialect: "postgres",
});

module.exports = sequelize;
