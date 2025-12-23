const moment = require('moment-timezone');
const { KEYWORDS, timeToMinutes } = require('../utils/helpers');

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
      return { logged: false, reason: 'duplicate' };
    }

    // Append to raw logs (without Slack Username)
    await this.sheetsService.appendToRawLogs({
      date,
      time,
      employeeName,
      channelName,
      keyword
    });

    console.log(`📝 Logged raw event: ${keyword} at ${time}`);

    // Update daily summary (using employeeName instead of slackUsername)
    const summary = await this.updateDailySummary(date, employeeName);

    // Return summary for potential Slack notification
    return { 
      logged: true, 
      keyword,
      summary,
      isFinalReport: keyword === KEYWORDS.EXIT || keyword === KEYWORDS.DAILY_REPORT
    };
  }

  async updateDailySummary(date, employeeName) {
    // Get all logs for this date
    const dailyLogs = await this.sheetsService.getDailyLogs(date);
    // Filter by Employee Name (column index 2, since Slack Username removed)
    const userLogs = dailyLogs.filter(log => log[2] === employeeName);

    if (userLogs.length === 0) {
      return null;
    }

    // Sort logs by time
    userLogs.sort((a, b) => {
      const timeA = timeToMinutes(a[1]);
      const timeB = timeToMinutes(b[1]);
      return timeA - timeB;
    });

    // ============================================
    // TOTAL HOURS: #entry to #exit
    // ============================================
    const entryLog = userLogs.find(log => log[4] === KEYWORDS.ENTRY); // Column E (index 4) is Keyword
    const entryTime = entryLog ? entryLog[1] : '-'; // Column B (index 1) is Time

    const exitLogs = userLogs.filter(log => log[4] === KEYWORDS.EXIT);
    const exitTime = exitLogs.length > 0 ? exitLogs[exitLogs.length - 1][1] : '-';

    // Total Hours = #exit - #entry
    const totalHours = this.calculateDuration(entryTime, exitTime);

    // ============================================
    // WORKING HOURS: #daily-task to #daily-report
    // ============================================
    const taskStartLog = userLogs.find(log => log[4] === KEYWORDS.DAILY_TASK);
    const taskStartTime = taskStartLog ? taskStartLog[1] : '-';

    const taskEndLogs = userLogs.filter(log => log[4] === KEYWORDS.DAILY_REPORT);
    const taskEndTime = taskEndLogs.length > 0 ? taskEndLogs[taskEndLogs.length - 1][1] : '-';

    // Gross working time (before deducting lunch and breaks)
    const grossWorkingTime = this.calculateDuration(taskStartTime, taskEndTime);

    // ============================================
    // LUNCH DURATION: #lunchstart to #lunchend
    // ============================================
    const lunchDuration = this.calculateLunchDuration(userLogs);

    // ============================================
    // BREAK DURATION: Sum of all #breakstart to #breakend pairs
    // ============================================
    const breakDuration = this.calculateBreakDuration(userLogs);
    const breakCount = this.countBreaks(userLogs);

    // ============================================
    // NET WORKING HOURS
    // = (#daily-report - #daily-task) - lunch - breaks
    // ============================================
    const netWorkingHours = Math.max(0, grossWorkingTime - lunchDuration - breakDuration);

    const summaryData = {
      date,
      employeeName,
      // Office presence
      entryTime,           // #entry time
      exitTime,            // #exit time
      totalHours: this.formatDuration(totalHours),  // #exit - #entry
      // Work tracking
      taskStartTime,       // #daily-task time
      taskEndTime,         // #daily-report time
      // Deductions
      lunchDuration: this.formatDuration(lunchDuration),
      breakDuration: this.formatDuration(breakDuration),
      breakCount,
      // Final calculation
      netWorkingHours: this.formatDuration(netWorkingHours)
    };

    // Update the daily summary in Google Sheets
    await this.sheetsService.updateDailySummary(summaryData);

    console.log(`\n📊 Summary for ${employeeName} on ${date}:`);
    console.log(`   ┌─────────────────────────────────────────┐`);
    console.log(`   │ OFFICE PRESENCE                         │`);
    console.log(`   │   Entry (#entry):     ${entryTime.padEnd(12)}    │`);
    console.log(`   │   Exit (#exit):       ${exitTime.padEnd(12)}    │`);
    console.log(`   │   Total Hours:        ${this.formatDuration(totalHours).padEnd(12)}    │`);
    console.log(`   ├─────────────────────────────────────────┤`);
    console.log(`   │ WORK TRACKING                           │`);
    console.log(`   │   Task Start:         ${taskStartTime.padEnd(12)}    │`);
    console.log(`   │   Task End:           ${taskEndTime.padEnd(12)}    │`);
    console.log(`   │   Lunch Duration:     ${this.formatDuration(lunchDuration).padEnd(12)}    │`);
    console.log(`   │   Break Duration:     ${this.formatDuration(breakDuration)} (${breakCount} breaks) │`);
    console.log(`   ├─────────────────────────────────────────┤`);
    console.log(`   │ NET WORKING HOURS:    ${this.formatDuration(netWorkingHours).padEnd(12)}    │`);
    console.log(`   └─────────────────────────────────────────┘\n`);

    return summaryData;
  }

  calculateDuration(startTime, endTime) {
    if (startTime === '-' || endTime === '-') {
      return 0;
    }

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    if (endMinutes <= startMinutes) {
      return 0;
    }

    return endMinutes - startMinutes;
  }

  calculateLunchDuration(userLogs) {
    const lunchStart = userLogs.find(log => log[4] === KEYWORDS.LUNCH_START); // Column E (index 4)
    const lunchEnd = userLogs.find(log => log[4] === KEYWORDS.LUNCH_END);

    if (!lunchStart || !lunchEnd) {
      return 0;
    }

    const startMinutes = timeToMinutes(lunchStart[1]); // Column B (index 1) is Time
    const endMinutes = timeToMinutes(lunchEnd[1]);

    if (endMinutes > startMinutes) {
      return endMinutes - startMinutes;
    }

    return 0;
  }

  calculateBreakDuration(userLogs) {
    // Get all break start and end events sorted by time
    const breakStarts = userLogs
      .filter(log => log[4] === KEYWORDS.BREAK_START) // Column E (index 4) is Keyword
      .map(log => ({ time: log[1], minutes: timeToMinutes(log[1]) })) // Column B (index 1) is Time
      .sort((a, b) => a.minutes - b.minutes);

    const breakEnds = userLogs
      .filter(log => log[4] === KEYWORDS.BREAK_END)
      .map(log => ({ time: log[1], minutes: timeToMinutes(log[1]) }))
      .sort((a, b) => a.minutes - b.minutes);

    let totalBreakMinutes = 0;
    const usedEnds = new Set();

    // Match each break start with the next available break end
    for (const start of breakStarts) {
      for (let i = 0; i < breakEnds.length; i++) {
        if (!usedEnds.has(i) && breakEnds[i].minutes > start.minutes) {
          const breakTime = breakEnds[i].minutes - start.minutes;
          totalBreakMinutes += breakTime;
          usedEnds.add(i);
          console.log(`   Break: ${start.time} → ${breakEnds[i].time} = ${breakTime} mins`);
          break;
        }
      }
    }

    return totalBreakMinutes;
  }

  countBreaks(userLogs) {
    const breakStarts = userLogs.filter(log => log[4] === KEYWORDS.BREAK_START); // Column E (index 4)
    const breakEnds = userLogs.filter(log => log[4] === KEYWORDS.BREAK_END);
    
    // Return the minimum of starts and ends (completed breaks)
    return Math.min(breakStarts.length, breakEnds.length);
  }

  formatDuration(minutes) {
    if (minutes === 0 || isNaN(minutes)) {
      return '0:00';
    }

    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  }
}

module.exports = AttendanceService;
