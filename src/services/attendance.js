const moment = require('moment-timezone');
const { KEYWORDS, timeToMinutes, minutesToTimeString } = require('../utils/helpers');

class AttendanceService {
  constructor(sheetsService) {
    this.sheetsService = sheetsService;
    this.timezone = process.env.TIMEZONE || 'Asia/Kolkata';
  }

  async logEvent(eventData) {
    const { date, time, employeeName, slackUsername, channelName, keyword, slackTs } = eventData;

    // Check for duplicate events
    if (this.sheetsService.isEventProcessed(slackTs, keyword)) {
      console.log(`Skipping duplicate event: ${slackTs}-${keyword}`);
      return;
    }

    // Append to raw logs
    await this.sheetsService.appendToRawLogs({
      date,
      time,
      employeeName,
      slackUsername,
      channelName,
      keyword
    });

    // Update daily summary
    await this.updateDailySummary(date, slackUsername, employeeName);
  }

  async updateDailySummary(date, slackUsername, employeeName) {
    // Get all logs for this date and user
    const dailyLogs = await this.sheetsService.getDailyLogs(date);
    const userLogs = dailyLogs.filter(log => log[3] === slackUsername);

    if (userLogs.length === 0) {
      return;
    }

    // Sort logs by time
    userLogs.sort((a, b) => {
      const timeA = timeToMinutes(a[1]);
      const timeB = timeToMinutes(b[1]);
      return timeA - timeB;
    });

    // Calculate entry time (first #daily-task)
    const entryLog = userLogs.find(log => log[5] === KEYWORDS.DAILY_TASK);
    const entryTime = entryLog ? entryLog[1] : '-';

    // Calculate exit time (last #daily-report)
    const exitLogs = userLogs.filter(log => log[5] === KEYWORDS.DAILY_REPORT);
    const exitTime = exitLogs.length > 0 ? exitLogs[exitLogs.length - 1][1] : '-';

    // Calculate lunch duration
    const lunchDuration = this.calculateLunchDuration(userLogs);

    // Calculate total break duration
    const breakDuration = this.calculateBreakDuration(userLogs);

    // Calculate net working hours
    const netWorkingHours = this.calculateNetWorkingHours(entryTime, exitTime, lunchDuration, breakDuration);

    // Update the daily summary
    await this.sheetsService.updateDailySummary({
      date,
      slackUsername,
      employeeName,
      entryTime,
      exitTime,
      lunchDuration: this.formatDuration(lunchDuration),
      breakDuration: this.formatDuration(breakDuration),
      netWorkingHours: this.formatDuration(netWorkingHours)
    });
  }

  calculateLunchDuration(userLogs) {
    const lunchStart = userLogs.find(log => log[5] === KEYWORDS.LUNCH_START);
    const lunchEnd = userLogs.find(log => log[5] === KEYWORDS.LUNCH_END);

    if (!lunchStart || !lunchEnd) {
      return 0;
    }

    const startMinutes = timeToMinutes(lunchStart[1]);
    const endMinutes = timeToMinutes(lunchEnd[1]);

    // Only count if lunch end is after lunch start
    if (endMinutes > startMinutes) {
      return endMinutes - startMinutes;
    }

    return 0;
  }

  calculateBreakDuration(userLogs) {
    // Get all break start and end events
    const breakStarts = userLogs
      .filter(log => log[5] === KEYWORDS.BREAK_START)
      .map(log => ({ time: log[1], minutes: timeToMinutes(log[1]) }));

    const breakEnds = userLogs
      .filter(log => log[5] === KEYWORDS.BREAK_END)
      .map(log => ({ time: log[1], minutes: timeToMinutes(log[1]) }));

    let totalBreakMinutes = 0;

    // Match break starts with break ends
    const usedEnds = new Set();

    for (const start of breakStarts) {
      // Find the first break end that comes after this start and hasn't been used
      for (let i = 0; i < breakEnds.length; i++) {
        if (!usedEnds.has(i) && breakEnds[i].minutes > start.minutes) {
          totalBreakMinutes += breakEnds[i].minutes - start.minutes;
          usedEnds.add(i);
          break;
        }
      }
    }

    return totalBreakMinutes;
  }

  calculateNetWorkingHours(entryTime, exitTime, lunchMinutes, breakMinutes) {
    if (entryTime === '-' || exitTime === '-') {
      return 0;
    }

    const entryMinutes = timeToMinutes(entryTime);
    const exitMinutes = timeToMinutes(exitTime);

    if (exitMinutes <= entryMinutes) {
      return 0;
    }

    const totalMinutes = exitMinutes - entryMinutes;
    const netMinutes = totalMinutes - lunchMinutes - breakMinutes;

    return Math.max(0, netMinutes);
  }

  formatDuration(minutes) {
    if (minutes === 0) {
      return '0:00';
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  }
}

module.exports = AttendanceService;

