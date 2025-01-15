const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// Define the model
const AbsentRecord = sequelize.define("AbsentRecord", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    batch_name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    comment: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    requested_date: {
        type: DataTypes.STRING, 
        allowNull: false,
    },
    // details: {
    //     type: DataTypes.JSONB, // JSONB type for storing structured data
    //     allowNull: false,
    //     validate: {
    //         notEmpty: true,
    //     },
    // },
    approved_status: {
        type: DataTypes.BOOLEAN, 
        defaultValue: false, 
        allowNull: false,
    },
    is_inactive: {
        type: DataTypes.BOOLEAN, 
        defaultValue: false, 
        allowNull: false,
    },
     details: {
        type: DataTypes.JSONB, // JSONB type for storing structured data
        allowNull: false,
        defaultValue: {},
        // validate: {
        //     notEmpty: true,
        // },
    },
    video_details: {
        type: DataTypes.JSONB, // JSONB type for storing structured data
        allowNull: false,
        defaultValue: {},
        // validate: {
        //     notEmpty: true,
        // },
    },
}, {
    tableName: "absent_records",
    timestamps: true, // Adds `createdAt` and `updatedAt`
});

module.exports = AbsentRecord;
