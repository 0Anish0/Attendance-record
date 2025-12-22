# Slack Attendance & Working Hours Automation System

## 1. Background

Currently, employee attendance, lunch, breaks, and daily reporting are tracked manually through Slack messages in team-specific channels. This data is not centrally stored or automatically calculated, leading to manual effort and potential inaccuracies.

This document defines the requirements for a **custom-built automation system** that captures Slack activity based on predefined keywords and stores it in Google Sheets for automatic attendance and working-hours calculation.

---

## 2. Objective

The objective of this system is to:

* Automatically record attendance and activity timestamps from Slack
* Store all records in Google Sheets
* Calculate daily working hours automatically
* Maintain a permanent, auditable record
* Eliminate manual attendance tracking

---

## 3. Scope

### In Scope

* Slack message monitoring for specific keywords
* Support for multiple teams and channels
* Google Sheets integration
* Automated calculation of working hours
* Lunch and break tracking (multiple breaks allowed)

### Out of Scope

* Payroll processing
* Biometric or device-based attendance
* Manual data entry

---

## 4. Slack Workspace Details

### Slack Channels (Teams)

* `#team-309`
* `#team-338`

Each team posts messages only in its own Slack channel.

---

## 5. Keywords & Their Meaning

| Keyword         | Description                          |
| --------------- | ------------------------------------ |
| `#daily-task`   | Office entry / Attendance start      |
| `#daily-report` | Office exit / End of workday         |
| `#lunchstart`   | Lunch break start                    |
| `#lunchend`     | Lunch break end                      |
| `#breakstart`   | Short break start (washroom / other) |
| `#breakend`     | Short break end                      |

Keywords are case-insensitive and may appear anywhere in the Slack message.

---

## 6. Functional Requirements

### 6.1 Slack Event Capture

* The system must listen to Slack **message events** from configured channels
* Only user-generated messages should be processed (ignore bots)
* Messages without valid keywords should be ignored

### 6.2 Data to Capture Per Event

For every valid keyword message, capture:

* Date
* Time
* Employee name
* Slack username
* Slack channel name (team identifier)
* Keyword used

### 6.3 Data Storage

* All captured events must be stored in **Google Sheets**
* Data should be appended in real-time
* No manual intervention required

### 6.4 Attendance Logic

* First `#daily-task` of the day = **Entry Time**
* Last `#daily-report` of the day = **Exit Time**
* Missing exit should be flagged (future enhancement)

### 6.5 Lunch Calculation

* Lunch time = `#lunchend` − `#lunchstart`
* Only one lunch expected per day
* If lunch end/start missing, lunch duration = 0

### 6.6 Break Calculation

* Multiple breaks allowed per day
* Total break time = sum of (`#breakend` − `#breakstart`)

### 6.7 Working Hours Calculation

```
Net Working Hours = (Exit Time − Entry Time)
                     − Lunch Duration
                     − Total Break Duration
```

---

## 7. Google Sheets Structure

### 7.1 Sheet 1: `raw_logs`

(Immutable log of all Slack events)

| Column | Name           |
| ------ | -------------- |
| A      | Date           |
| B      | Time           |
| C      | Employee Name  |
| D      | Slack Username |
| E      | Channel Name   |
| F      | Keyword        |

### 7.2 Sheet 2: `daily_summary`

(Computed per employee per day)

| Column | Name              |
| ------ | ----------------- |
| A      | Date              |
| B      | Slack Username    |
| C      | Entry Time        |
| D      | Exit Time         |
| E      | Lunch Duration    |
| F      | Break Duration    |
| G      | Net Working Hours |

---

## 8. Non‑Functional Requirements

### Performance

* System should process Slack events in near real-time (<2 seconds)

### Reliability

* Duplicate Slack events should not create duplicate records

### Security

* Slack request signature verification required
* Google API credentials must be secured

### Scalability

* Easily add new teams, channels, or keywords

---

## 9. Technical Constraints

* No third‑party automation tools (Zapier, Make, etc.)
* Custom backend code only
* Slack Events API must be used
* Google Sheets API or Google Apps Script allowed

---

## 10. Assumptions

* All employees will post required keywords honestly
* Slack workspace timezone is consistent
* Internet connectivity is available

---

## 11. Future Enhancements (Optional)

* Late coming alerts
* Auto reminders for missing daily report
* Monthly summary dashboard
* CSV / Excel export

---

## 12. Acceptance Criteria

* Posting any defined keyword in Slack creates a row in Google Sheet
* Employee name and time are recorded correctly
* Daily working hours are calculated accurately
* Multiple breaks are handled correctly

---

**End of Document**
