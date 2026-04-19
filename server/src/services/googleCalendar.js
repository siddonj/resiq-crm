const { google } = require('googleapis');
const tokenManager = require('./oauth');

class GoogleCalendarService {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GCAL_CLIENT_ID || process.env.GMAIL_CLIENT_ID,
      process.env.GCAL_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET,
      `${process.env.API_URL || 'http://localhost:5000'}/api/integrations/gcal/callback`
    );
  }

  getAuthUrl(state) {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state,
      prompt: 'consent',
    });
  }

  async exchangeCodeForTokens(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date),
    };
  }

  async getAuthenticatedClient(userId) {
    const tokens = await tokenManager.getTokens(userId, 'gcal');
    if (!tokens) throw new Error('Google Calendar not connected');
    this.oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    return google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  async listEvents(userId, timeMin, timeMax) {
    const cal = await this.getAuthenticatedClient(userId);
    const res = await cal.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    return res.data.items || [];
  }

  async createEvent(userId, { title, description, start_at, end_at }) {
    const cal = await this.getAuthenticatedClient(userId);
    const res = await cal.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: title,
        description,
        start: { dateTime: start_at },
        end: { dateTime: end_at },
      },
    });
    return res.data;
  }

  async deleteEvent(userId, googleEventId) {
    const cal = await this.getAuthenticatedClient(userId);
    await cal.events.delete({ calendarId: 'primary', eventId: googleEventId });
  }
}

module.exports = new GoogleCalendarService();
