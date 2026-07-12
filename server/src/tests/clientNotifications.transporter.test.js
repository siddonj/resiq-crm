jest.mock('../services/integrationSettings', () => ({
  getSetting: jest.fn(),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn() }),
}));

const { getSetting } = require('../services/integrationSettings');
const nodemailer = require('nodemailer');
const { getMailTransporter, getMailFrom } = require('../services/clientNotifications');

describe('getMailTransporter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
  });

  test('builds an SMTP transporter from resolved DB/env credentials', async () => {
    getSetting.mockImplementation((key) => {
      const values = {
        smtp_host: 'smtp.example.com',
        smtp_user: 'user@example.com',
        smtp_pass: 'secret',
        smtp_port: 465,
        smtp_secure: true,
      };
      return Promise.resolve(values[key] ?? null);
    });

    await getMailTransporter();

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'user@example.com', pass: 'secret' },
    });
  });

  test('falls back to Gmail when SMTP is not configured', async () => {
    getSetting.mockResolvedValue(null);
    process.env.GMAIL_USER = 'gmail-user@example.com';
    process.env.GMAIL_APP_PASSWORD = 'app-password';

    await getMailTransporter();

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      service: 'gmail',
      auth: { user: 'gmail-user@example.com', pass: 'app-password' },
    });
  });
});

describe('getMailFrom', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GMAIL_USER;
  });

  test('resolves smtp_from from the DB when set', async () => {
    getSetting.mockImplementation((key) => {
      const values = {
        smtp_from: 'noreply@example.com',
        smtp_user: 'user@example.com',
      };
      return Promise.resolve(values[key] ?? null);
    });

    await expect(getMailFrom()).resolves.toBe('noreply@example.com');
  });

  test('falls back to smtp_user when smtp_from is unset', async () => {
    getSetting.mockImplementation((key) => {
      const values = {
        smtp_from: null,
        smtp_user: 'user@example.com',
      };
      return Promise.resolve(values[key] ?? null);
    });

    await expect(getMailFrom()).resolves.toBe('user@example.com');
  });

  test('falls back to process.env.GMAIL_USER when neither DB field resolves', async () => {
    getSetting.mockResolvedValue(null);
    process.env.GMAIL_USER = 'gmail-user@example.com';

    await expect(getMailFrom()).resolves.toBe('gmail-user@example.com');
  });
});
