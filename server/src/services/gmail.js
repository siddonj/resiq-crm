const { google } = require('googleapis');
const tokenManager = require('./oauth');

class GmailService {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      `${process.env.API_URL || 'http://localhost:5000'}/api/integrations/gmail/callback`
    );
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  // Get authorization URL for user to grant access
  getAuthUrl(state) {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state,
      prompt: 'consent', // Force consent to always get refresh token
    });
  }

  // Exchange auth code for tokens
  async exchangeCodeForTokens(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date),
    };
  }

  // Get a fresh access token using refresh token
  async refreshAccessToken(user_id) {
    const tokens = await tokenManager.getTokens(user_id);
    if (!tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    this.oauth2Client.setCredentials({
      refresh_token: tokens.refreshToken,
    });

    const { credentials } = await this.oauth2Client.refreshAccessToken();
    const expiresAt = new Date(credentials.expiry_date);

    // Save new access token
    await tokenManager.saveTokens(
      user_id,
      'gmail',
      credentials.access_token,
      tokens.refreshToken, // Keep existing refresh token
      expiresAt
    );

    return {
      accessToken: credentials.access_token,
      expiresAt,
    };
  }

  // Set up oauth2Client with user's tokens
  async setupUserAuth(user_id) {
    let tokens = await tokenManager.getTokens(user_id);
    if (!tokens) throw new Error('User not connected to Gmail');

    // Check if token expired, refresh if needed
    if (tokenManager.isTokenExpired(tokens.expiresAt)) {
      console.log(`Token expired for user ${user_id}, refreshing...`);
      const refreshed = await this.refreshAccessToken(user_id);
      tokens.accessToken = refreshed.accessToken;
      tokens.expiresAt = refreshed.expiresAt;
    }

    this.oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: new Date(tokens.expiresAt).getTime(),
    });

    return tokens;
  }

  // Get user's email address
  async getUserEmail(user_id) {
    await this.setupUserAuth(user_id);

    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const { data } = await oauth2.userinfo.get();
      return data.email;
    } catch (err) {
      console.error('Error getting user email:', err);
      throw err;
    }
  }

  // Fetch emails from Gmail (paginated)
  async fetchEmails(user_id, options = {}) {
    await this.setupUserAuth(user_id);

    const {
      maxResults = 10,
      pageToken = null,
      query = 'is:unread OR newer_than:7d', // Default: unread or last 7 days
      includeSpamTrash = false,
    } = options;

    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q: query,
        pageToken,
        includeSpamTrash,
      });

      const messages = response.data.messages || [];
      const nextPageToken = response.data.nextPageToken;

      // Get full message details for each
      const fullMessages = await Promise.all(
        messages.map((msg) => this.getMessageDetail(user_id, msg.id))
      );

      return {
        messages: fullMessages.filter(Boolean), // Remove nulls from errors
        nextPageToken,
      };
    } catch (err) {
      console.error('Error fetching emails:', err);
      throw err;
    }
  }

  // Get full message details
  async getMessageDetail(user_id, messageId) {
    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const message = response.data;
      const headers = message.payload?.headers || [];
      const getHeader = (name) => headers.find((h) => h.name === name)?.value;

      return {
        id: message.id,
        threadId: message.threadId,
        from: getHeader('From'),
        to: getHeader('To'),
        cc: getHeader('Cc'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        body: this.extractBody(message.payload),
        labels: message.labelIds || [],
      };
    } catch (err) {
      console.error(`Error getting message ${messageId}:`, err);
      return null;
    }
  }

  // Extract email body (handles both plain text and HTML)
  extractBody(payload) {
    if (!payload) return '';

    // Check for plain text part
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    // Check for HTML part
    if (payload.mimeType === 'text/html' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    // Recursively check parts if multipart
    if (payload.parts) {
      for (const part of payload.parts) {
        const extracted = this.extractBody(part);
        if (extracted) return extracted;
      }
    }

    return payload.body?.data ? Buffer.from(payload.body.data, 'base64').toString('utf-8') : '';
  }

  // Parse email address from "Name <email@example.com>" format
  parseEmailAddress(emailString) {
    if (!emailString) return null;
    const match = emailString.match(/<(.+?)>/);
    return match ? match[1] : emailString.trim();
  }

  // Revoke access (disconnect)
  async revokeAccess() {
    try {
      await this.oauth2Client.revokeCredentials();
    } catch (err) {
      console.error('Error revoking credentials:', err);
      // Don't throw, just log - user might have already revoked on Google side
    }
  }
}

module.exports = new GmailService();
