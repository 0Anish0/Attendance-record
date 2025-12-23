const { google } = require('googleapis');

class GoogleSheetsService {
  constructor() {
    this.sheets = null;
    this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    this.processedEvents = new Set(); // For deduplication
  }

  async initialize() {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    this.sheets = google.sheets({ version: 'v4', auth: authClient });
  }

  async ensureSheetsExist() {
    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

      const requiredSheets = [
        { 
          name: 'raw_logs', 
          headers: ['Date', 'Time', 'Employee Name', 'Channel Name', 'Keyword'],
          range: 'A1:E1',
          clearRange: 'A1:Z1' // Clear entire header row to remove old columns
        },
        { 
          name: 'daily_summary', 
          headers: [
            'Date',              // A
            'Employee Name',     // B
            'Entry Time',        // C - #entry
            'Exit Time',         // D - #exit
            'Total Hours',       // E - #exit - #entry (office presence)
            'Task Start',        // F - #daily-task
            'Task End',          // G - #daily-report
            'Lunch Duration',    // H - #lunchstart to #lunchend
            'Break Duration',    // I - Sum of all breaks
            'Break Count',       // J - Number of breaks
            'Net Working Hours'  // K - (Task End - Task Start) - Lunch - Breaks
          ],
          range: 'A1:K1',
          clearRange: 'A1:Z1' // Clear entire header row to remove duplicate columns
        }
      ];

      for (const sheet of requiredSheets) {
        if (!existingSheets.includes(sheet.name)) {
          // Create the sheet
          await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            resource: {
              requests: [{
                addSheet: {
                  properties: { title: sheet.name }
                }
              }]
            }
          });

          // Add headers
          await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `${sheet.name}!${sheet.range}`,
            valueInputOption: 'RAW',
            resource: {
              values: [sheet.headers]
            }
          });

          console.log(`Created sheet: ${sheet.name} with headers`);
        } else {
          // Clear old headers completely (including any extra columns)
          await this.sheets.spreadsheets.values.clear({
            spreadsheetId: this.spreadsheetId,
            range: `${sheet.name}!${sheet.clearRange}`
          });

          // Write correct headers
          await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `${sheet.name}!${sheet.range}`,
            valueInputOption: 'RAW',
            resource: {
              values: [sheet.headers]
            }
          });

          console.log(`✅ Updated headers for sheet: ${sheet.name}`);
        }
      }
    } catch (error) {
      console.error('Error ensuring sheets exist:', error);
      throw error;
    }
  }

  // Check if event already processed (deduplication)
  isEventProcessed(slackTs, keyword) {
    const eventKey = `${slackTs}-${keyword}`;
    if (this.processedEvents.has(eventKey)) {
      return true;
    }
    this.processedEvents.add(eventKey);
    
    // Clean up old entries (keep last 10000)
    if (this.processedEvents.size > 10000) {
      const arr = Array.from(this.processedEvents);
      this.processedEvents = new Set(arr.slice(-5000));
    }
    
    return false;
  }

  async appendToRawLogs(data) {
    const { date, time, employeeName, channelName, keyword } = data;

    // Ensure data array matches headers exactly: Date, Time, Employee Name, Channel Name, Keyword
    const rowData = [
      date,          // A - Date
      time,          // B - Time
      employeeName,  // C - Employee Name
      channelName,   // D - Channel Name
      keyword        // E - Keyword
    ];

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'raw_logs!A:E',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [rowData]
      }
    });
  }

  async getDailyLogs(date) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'raw_logs!A:E',
      });

      const rows = response.data.values || [];
      // Filter by date (skip header row)
      // Column structure: A=Date, B=Time, C=Employee Name, D=Channel Name, E=Keyword
      return rows.slice(1).filter(row => row && row[0] === date);
    } catch (error) {
      console.error('Error getting daily logs:', error);
      return [];
    }
  }

  async updateDailySummary(summaryData) {
    const { 
      date, 
      employeeName, 
      entryTime,        // #entry
      exitTime,         // #exit
      totalHours,       // #exit - #entry
      taskStartTime,    // #daily-task
      taskEndTime,      // #daily-report
      lunchDuration, 
      breakDuration, 
      breakCount,
      netWorkingHours   // (taskEnd - taskStart) - lunch - breaks
    } = summaryData;

    try {
      // Get existing summary data
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'daily_summary!A:K',
      });

      const rows = response.data.values || [];
      
      // Find if entry exists for this employee and date
      // Column structure: A=Date, B=Employee Name, C=Entry Time, ...
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i] && rows[i][0] === date && rows[i][1] === employeeName) {
          rowIndex = i + 1; // +1 because sheets are 1-indexed
          break;
        }
      }

      // Row data matching headers exactly - 11 columns (A through K)
      const rowData = [
        date || '-',              // A - Date
        employeeName || '-',      // B - Employee Name
        entryTime || '-',         // C - Entry Time (#entry)
        exitTime || '-',          // D - Exit Time (#exit)
        totalHours || '0:00',     // E - Total Hours (#exit - #entry)
        taskStartTime || '-',     // F - Task Start (#daily-task)
        taskEndTime || '-',       // G - Task End (#daily-report)
        lunchDuration || '0:00',  // H - Lunch Duration
        breakDuration || '0:00',  // I - Break Duration (all breaks combined)
        breakCount || 0,          // J - Number of breaks
        netWorkingHours || '0:00' // K - Net Working Hours
      ];

      if (rowIndex > 0) {
        // Update existing row - clear the entire row first to remove old misaligned data
        await this.sheets.spreadsheets.values.clear({
          spreadsheetId: this.spreadsheetId,
          range: `daily_summary!A${rowIndex}:Z${rowIndex}`
        });

        // Then write correct data
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `daily_summary!A${rowIndex}:K${rowIndex}`,
          valueInputOption: 'RAW',
          resource: {
            values: [rowData]
          }
        });
        console.log(`📊 Updated existing row ${rowIndex} for ${employeeName}`);
      } else {
        // Append new row
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: 'daily_summary!A:K',
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          resource: {
            values: [rowData]
          }
        });
        console.log(`📊 Added new row for ${employeeName}`);
      }
    } catch (error) {
      console.error('Error updating daily summary:', error);
      throw error;
    }
  }
}

module.exports = GoogleSheetsService;
