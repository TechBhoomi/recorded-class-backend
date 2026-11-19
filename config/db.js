const { Sequelize } = require("sequelize");

// Configure Sequelize to connect to your PostgreSQL database
const sequelize = new Sequelize("recorded_class", "postgres", "SHKweTYdeqn@723", {
    host: "localhost",
    dialect: "postgres",
});

module.exports = sequelize;
