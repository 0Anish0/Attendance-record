require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');
const GoogleSheetsService = require('./services/googleSheets');
const AttendanceService = require('./services/attendance');
const { KEYWORDS, extractKeyword, parseSlackTimestamp } = require('./utils/helpers');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Slack Web Client
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Initialize services
const sheetsService = new GoogleSheetsService();
const attendanceService = new AttendanceService(sheetsService);

// Store raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Slack signature verification middleware
function verifySlackRequest(req, res, next) {
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  const slackSignature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];

  if (!slackSignature || !timestamp) {
    console.log('Missing Slack signature headers');
    return res.status(401).send('Missing signature headers');
  }

  // Prevent replay attacks (5 minute window)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
    console.log('Request timestamp too old');
    return res.status(401).send('Request too old');
  }

  const sigBasestring = `v0:${timestamp}:${req.rawBody}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', slackSigningSecret)
    .update(sigBasestring)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(slackSignature))) {
    console.log('Invalid signature');
    return res.status(401).send('Invalid signature');
  }

  next();
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Slack Attendance System is running',
    version: '1.0.0'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main Slack events endpoint
app.post('/slack/events', verifySlackRequest, async (req, res) => {
  const { type, challenge, event } = req.body;

  // Handle URL verification challenge
  if (type === 'url_verification') {
    console.log('URL verification challenge received');
    return res.json({ challenge });
  }

  // Respond immediately to Slack (within 3 seconds)
  res.status(200).send();

  // Process event asynchronously
  if (type === 'event_callback' && event) {
    try {
      await handleSlackEvent(event);
    } catch (error) {
      console.error('Error processing event:', error);
    }
  }
});

// Handle Slack message events
async function handleSlackEvent(event) {
  // Only process message events
  if (event.type !== 'message') {
    return;
  }

  // Ignore bot messages, message edits, and deletions
  if (event.bot_id || event.subtype) {
    return;
  }

  const { text, user, channel, ts } = event;

  if (!text || !user) {
    return;
  }

  // Extract keyword from message
  const keyword = extractKeyword(text);
  if (!keyword) {
    return;
  }

  console.log(`Processing message: User=${user}, Channel=${channel}, Keyword=${keyword}`);

  try {
    // Get user info from Slack
    const userInfo = await slackClient.users.info({ user });
    const employeeName = userInfo.user.real_name || userInfo.user.name;
    const slackUsername = userInfo.user.name;

    // Get channel info
    const channelInfo = await slackClient.conversations.info({ channel });
    const channelName = channelInfo.channel.name;

    // Parse timestamp
    const { date, time } = parseSlackTimestamp(ts);

    // Log the attendance event
    await attendanceService.logEvent({
      date,
      time,
      employeeName,
      slackUsername,
      channelName,
      keyword,
      slackTs: ts
    });

    console.log(`✅ Logged: ${employeeName} - ${keyword} at ${time} on ${date}`);
  } catch (error) {
    console.error('Error processing attendance:', error);
  }
}

// Initialize and start server
async function startServer() {
  try {
    // Initialize Google Sheets
    await sheetsService.initialize();
    console.log('✅ Google Sheets connected');

    // Ensure sheets exist
    await sheetsService.ensureSheetsExist();
    console.log('✅ Sheets structure verified');

    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════════╗
║     Slack Attendance System Started Successfully!          ║
╠════════════════════════════════════════════════════════════╣
║  Server running on port: ${PORT}                              ║
║  Slack Events URL: http://your-domain:${PORT}/slack/events    ║
║                                                            ║
║  Monitored Keywords:                                       ║
║    • #daily-task   → Entry Time                            ║
║    • #daily-report → Exit Time                             ║
║    • #lunchstart   → Lunch Start                           ║
║    • #lunchend     → Lunch End                             ║
║    • #breakstart   → Break Start                           ║
║    • #breakend     → Break End                             ║
╚════════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

