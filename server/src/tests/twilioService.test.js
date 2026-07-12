jest.mock('../services/integrationSettings', () => ({
  getSetting: jest.fn(),
}));

jest.mock('twilio', () => {
  const twilioFn = jest.fn(() => ({
    messages: { create: jest.fn().mockResolvedValue({ sid: 'SM123', status: 'queued' }) },
  }));
  twilioFn.webhook = { validateRequest: jest.fn().mockReturnValue(true) };
  return twilioFn;
});

const { getSetting } = require('../services/integrationSettings');
const twilio = require('twilio');
const TwilioService = require('../services/twilioService');

describe('TwilioService lazy client', () => {
  beforeEach(() => jest.clearAllMocks());

  test('isConfigured is false when credentials are not resolved', async () => {
    getSetting.mockResolvedValue(null);

    await expect(TwilioService.isConfigured()).resolves.toBe(false);
  });

  test('isConfigured is true and builds the client from resolved DB/env credentials', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'twilio_account_sid') return Promise.resolve('AC123');
      if (key === 'twilio_auth_token') return Promise.resolve('token123');
      return Promise.resolve(null);
    });

    await expect(TwilioService.isConfigured()).resolves.toBe(true);
    expect(twilio).toHaveBeenCalledWith('AC123', 'token123');
  });

  test('sendSMS returns "not configured" without calling the Twilio API', async () => {
    getSetting.mockResolvedValue(null);

    const result = await TwilioService.sendSMS({ to: '+15550001111', content: 'hi' });

    expect(result).toEqual({ success: false, error: 'Twilio not configured' });
  });

  test('sendSMS uses the resolved phone number as the "from" field', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'twilio_account_sid') return Promise.resolve('AC123');
      if (key === 'twilio_auth_token') return Promise.resolve('token123');
      if (key === 'twilio_phone_number') return Promise.resolve('+15559998888');
      return Promise.resolve(null);
    });

    const result = await TwilioService.sendSMS({ to: '+15550001111', content: 'hi' });

    expect(result.success).toBe(true);
    const clientInstance = twilio.mock.results[0].value;
    expect(clientInstance.messages.create).toHaveBeenCalledWith({
      body: 'hi',
      from: '+15559998888',
      to: '+15550001111',
    });
  });
});
