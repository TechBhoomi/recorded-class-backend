const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// Define the model
const DownloadVideos = sequelize.define("DownloadVideos", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    batch_name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    requested_date: {
        type: DataTypes.STRING, 
        allowNull: false,
    },
    download_status: {
        type: DataTypes.STRING,
        defaultValue: null,
        allowNull: true,
    },
    delete_status: {
        type: DataTypes.BOOLEAN, 
        defaultValue: false, 
        allowNull: false,
    },
    active_upto: {
        type: DataTypes.DATE,
        defaultValue: null,
        allowNull: true,
    },
    file_details: {
        type: DataTypes.JSONB, // JSONB type for storing structured data
        allowNull: false,
        defaultValue: [],
    },
     details: {
        type: DataTypes.JSONB, // JSONB type for storing structured data
        allowNull: false,
        defaultValue: [],
    },
}, {
    tableName: "download_videos",
    timestamps: true, // Adds `createdAt` and `updatedAt`
});

module.exports = DownloadVideos;
