const moment = require('moment-timezone');

// Keywords configuration
const KEYWORDS = {
  // Total hours tracking (office entry/exit)
  ENTRY: '#entry',
  EXIT: '#exit',
  
  // Working hours tracking (actual work start/end)
  DAILY_TASK: '#daily-task',
  DAILY_REPORT: '#daily-report',
  
  // Lunch tracking
  LUNCH_START: '#lunchstart',
  LUNCH_END: '#lunchend',
  
  // Break tracking (multiple allowed)
  BREAK_START: '#breakstart',
  BREAK_END: '#breakend'
};

// All keywords as an array for matching
const ALL_KEYWORDS = Object.values(KEYWORDS);

/**
 * Extract keyword from message text (case-insensitive)
 * @param {string} text - Message text
 * @returns {string|null} - Matched keyword or null
 */
function extractKeyword(text) {
  const lowerText = text.toLowerCase();
  
  for (const keyword of ALL_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return keyword;
    }
  }
  
  return null;
}

/**
 * Parse Slack timestamp to date and time
 * @param {string} ts - Slack timestamp (e.g., "1671234567.123456")
 * @returns {object} - { date: "YYYY-MM-DD", time: "HH:mm:ss" }
 */
function parseSlackTimestamp(ts) {
  const timezone = process.env.TIMEZONE || 'Asia/Kolkata';
  const unixTimestamp = parseFloat(ts);
  const dateTime = moment.unix(unixTimestamp).tz(timezone);
  
  return {
    date: dateTime.format('YYYY-MM-DD'),
    time: dateTime.format('HH:mm:ss')
  };
}

/**
 * Convert time string (HH:mm:ss or HH:mm) to minutes since midnight
 * @param {string} timeStr - Time string
 * @returns {number} - Minutes since midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr || timeStr === '-') {
    return 0;
  }
  
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  
  return hours * 60 + minutes;
}

/**
 * Convert minutes to time string
 * @param {number} totalMinutes - Total minutes
 * @returns {string} - Time string in HH:mm format
 */
function minutesToTimeString(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Calculate duration between two times
 * @param {string} startTime - Start time (HH:mm:ss)
 * @param {string} endTime - End time (HH:mm:ss)
 * @returns {number} - Duration in minutes
 */
function calculateDuration(startTime, endTime) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  
  if (endMinutes >= startMinutes) {
    return endMinutes - startMinutes;
  }
  
  // Handle overnight (shouldn't happen in normal cases)
  return 0;
}

module.exports = {
  KEYWORDS,
  ALL_KEYWORDS,
  extractKeyword,
  parseSlackTimestamp,
  timeToMinutes,
  minutesToTimeString,
  calculateDuration
};
