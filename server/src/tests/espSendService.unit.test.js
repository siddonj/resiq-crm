jest.mock('../services/integrationSettings', () => ({
  getSetting: jest.fn(),
}));

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

jest.mock('../services/outbound/complianceService', () => ({
  unsubscribeUrl: jest.fn(() => 'https://app.example.com/api/unsubscribe/tok123'),
}));

const axios = require('axios');
const { getSetting } = require('../services/integrationSettings');
const { sendEmail, textToHtml } = require('../services/espSendService');

describe('textToHtml', () => {
  test('escapes HTML and preserves newlines via pre-wrap container', () => {
    const html = textToHtml('Hi <b>there</b>\nline two');
    expect(html).toContain('&lt;b&gt;there&lt;/b&gt;');
    expect(html).toContain('white-space:pre-wrap');
  });

  test('turns bare URLs into anchors', () => {
    const html = textToHtml('See https://example.com/page');
    expect(html).toContain('<a href="https://example.com/page">');
  });
});

describe('sendEmail', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws 503 when SendGrid is not configured', async () => {
    getSetting.mockResolvedValue(null);
    await expect(
      sendEmail({ userId: 'u1', to: 'a@b.com', subject: 'Hi', text: 'body' })
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('sends via SendGrid with unsubscribe headers, custom_args, and mailbox from', async () => {
    getSetting.mockImplementation((key) =>
      Promise.resolve(key === 'sendgrid_api_key' ? 'SG.key' : null)
    );
    axios.post.mockResolvedValue({ headers: { 'x-message-id': 'msg-1' } });

    const result = await sendEmail({
      userId: 'u1',
      mailbox: { id: 'mb1', email: 'josh@resiq.co' },
      to: 'lead@example.com',
      subject: 'Hello',
      text: 'Plain body',
      metadata: { draftId: 'd1', mailboxId: 'mb1' },
    });

    expect(result).toEqual({ messageId: 'msg-1' });
    const [url, payload, config] = axios.post.mock.calls[0];
    expect(url).toContain('sendgrid.com/v3/mail/send');
    expect(config.headers.Authorization).toBe('Bearer SG.key');
    expect(payload.from.email).toBe('josh@resiq.co');
    expect(payload.personalizations[0].to).toEqual([{ email: 'lead@example.com' }]);
    expect(payload.personalizations[0].custom_args).toEqual({ userId: 'u1', draftId: 'd1', mailboxId: 'mb1' });
    expect(payload.headers['List-Unsubscribe']).toContain('/api/unsubscribe/');
    expect(payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(payload.content.map((c) => c.type)).toEqual(['text/plain', 'text/html']);
  });

  test('wraps ESP failures with detail and leaves status decisions to callers', async () => {
    getSetting.mockImplementation((key) =>
      Promise.resolve(key === 'sendgrid_api_key' ? 'SG.key' : 'from@resiq.co')
    );
    axios.post.mockRejectedValue({
      response: { status: 400, data: { errors: [{ message: 'bad from address' }] } },
      message: 'Request failed',
    });

    await expect(
      sendEmail({ userId: 'u1', to: 'a@b.com', subject: 'Hi', text: 'body' })
    ).rejects.toThrow('ESP send failed: bad from address');
  });
});
