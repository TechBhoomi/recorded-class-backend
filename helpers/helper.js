const fs = require("fs");
const path = require("path");
const { Op } = require('sequelize'); 
const AbsentRecord = require("../models/absent_records");

const GetThirtyDaysAgo = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
// const GetThirtyDaysAgo = () => new Date(new Date("2025-02-14T17:55:25.684Z").getTime() - 30 * 24 * 60 * 60 * 1000);

// console.log(GetThirtyDaysAgo().toISOString()); // 

const IsWithinThirtyDays = (date, referenceDate = new Date()) => {
  const targetDate = new Date(date);
  const thirtyDaysAgo = GetThirtyDaysAgo();
  return targetDate >= thirtyDaysAgo && targetDate <= referenceDate;
};

const sortAndFilterDates = (dates) => {
  let today = new Date();
  // today = new Date("2025-02-14T17:55:25.684Z");
  console.log(today,"kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk");
  
  const thirtyDaysAgo = GetThirtyDaysAgo();
  return dates
    .filter((date) => {
      const targetDate = new Date(date);
      return targetDate >= thirtyDaysAgo && targetDate <= today; // Ensure date is within the last 30 days
    })
    .sort((a, b) => new Date(a) - new Date(b)); // Sort in descending order
};

const IsRequested = async (student_id, batch_name, absent_dates) => {
  const thirtyDaysAgo = GetThirtyDaysAgo();
  absent_dates.sort((a, b) => new Date(a) - new Date(b));
  // Fetch approved requests within the last 30 days
  const existingRecords = await AbsentRecord.findAll({
    where: {
      student_id,
      batch_name,
      approved_status: true,
      updatedAt: { [Op.gte]: thirtyDaysAgo },
    },
    order: [["id", "ASC"]], // Oldest records first
  });

  const requestedDates = [];
  const activeDates = [];
  const updatedDates = [];

  // Extract requested and active dates from records
  existingRecords.forEach((record) => {
    const { requested_video_date, active_video_dates,updated_dates } = record.video_details;
    if (requested_video_date) requestedDates.push(requested_video_date);
    if (active_video_dates) activeDates.push(...active_video_dates);
    if (updated_dates) updatedDates.push(...updated_dates);
    console.log(record.video_details.updated_dates);
    
  });
  console.log("Valid updated Dates:", updatedDates);
  // Filter absent dates to include only those within 30 days
  // const validAbsentDates = absent_dates.filter(IsWithinThirtyDays);
  console.log("Valid Absent Dates:", activeDates);
  // Combine requested dates and absent dates, ensuring no duplicates
  const allDates = activeDates.concat(requestedDates)
  // [...new Set([...activeDates, ...requestedDates])];

  // Sort and limit the dates to the most recent 5
  // const validDates = sortAndFilterDates(allDates);

  // console.log("Valid Absent Dates:", validAbsentDates);
  console.log("Requested Dates:", requestedDates);
  console.log("Final Active Dates:", allDates);

  return {
    active_dates: allDates,
    active_dates_length:allDates.length,
    // validDates.slice(0, 5), // Display only the latest 5 videos
    requested_dates_length: requestedDates.length,
  };
};
module.exports = {
  IsRequested,
  GetThirtyDaysAgo,
  IsWithinThirtyDays,
  SortAndFilterDates: sortAndFilterDates,
};

