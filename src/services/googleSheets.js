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
        { name: 'raw_logs', headers: ['Date', 'Time', 'Employee Name', 'Slack Username', 'Channel Name', 'Keyword'] },
        { name: 'daily_summary', headers: ['Date', 'Slack Username', 'Employee Name', 'Entry Time', 'Exit Time', 'Lunch Duration', 'Break Duration', 'Net Working Hours'] }
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
            range: `${sheet.name}!A1`,
            valueInputOption: 'RAW',
            resource: {
              values: [sheet.headers]
            }
          });

          console.log(`Created sheet: ${sheet.name}`);
        } else {
          // Verify headers exist
          const headerCheck = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${sheet.name}!A1:H1`,
          });

          if (!headerCheck.data.values || headerCheck.data.values.length === 0) {
            await this.sheets.spreadsheets.values.update({
              spreadsheetId: this.spreadsheetId,
              range: `${sheet.name}!A1`,
              valueInputOption: 'RAW',
              resource: {
                values: [sheet.headers]
              }
            });
          }
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
    const { date, time, employeeName, slackUsername, channelName, keyword } = data;

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'raw_logs!A:F',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [[date, time, employeeName, slackUsername, channelName, keyword]]
      }
    });
  }

  async getDailyLogs(date) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'raw_logs!A:F',
      });

      const rows = response.data.values || [];
      // Filter by date (skip header row)
      return rows.slice(1).filter(row => row[0] === date);
    } catch (error) {
      console.error('Error getting daily logs:', error);
      return [];
    }
  }

  async updateDailySummary(summaryData) {
    const { date, slackUsername, employeeName, entryTime, exitTime, lunchDuration, breakDuration, netWorkingHours } = summaryData;

    try {
      // Get existing summary data
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'daily_summary!A:H',
      });

      const rows = response.data.values || [];
      
      // Find if entry exists for this user and date
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === date && rows[i][1] === slackUsername) {
          rowIndex = i + 1; // +1 because sheets are 1-indexed
          break;
        }
      }

      const rowData = [date, slackUsername, employeeName, entryTime, exitTime, lunchDuration, breakDuration, netWorkingHours];

      if (rowIndex > 0) {
        // Update existing row
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `daily_summary!A${rowIndex}:H${rowIndex}`,
          valueInputOption: 'RAW',
          resource: {
            values: [rowData]
          }
        });
      } else {
        // Append new row
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: 'daily_summary!A:H',
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          resource: {
            values: [rowData]
          }
        });
      }
    } catch (error) {
      console.error('Error updating daily summary:', error);
      throw error;
    }
  }
}

module.exports = GoogleSheetsService;

