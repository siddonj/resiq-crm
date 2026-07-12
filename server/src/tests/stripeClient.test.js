jest.mock('../services/integrationSettings', () => ({
  getSetting: jest.fn(),
}));

jest.mock('stripe', () => jest.fn((key) => ({ __secretKey: key })));

const { getSetting } = require('../services/integrationSettings');
const Stripe = require('stripe');
const { getStripeClient, getStripeWebhookSecret } = require('../services/stripeClient');

describe('stripeClient', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getStripeClient returns null when no secret key is resolved', async () => {
    getSetting.mockResolvedValue(null);

    await expect(getStripeClient()).resolves.toBeNull();
    expect(Stripe).not.toHaveBeenCalled();
  });

  test('getStripeClient builds a client from the resolved secret key', async () => {
    getSetting.mockResolvedValue('sk_test_123');

    const client = await getStripeClient();

    expect(Stripe).toHaveBeenCalledWith('sk_test_123');
    expect(client).toEqual({ __secretKey: 'sk_test_123' });
  });

  test('getStripeWebhookSecret resolves via integrationSettings', async () => {
    getSetting.mockResolvedValue('whsec_abc');

    await expect(getStripeWebhookSecret()).resolves.toBe('whsec_abc');
    expect(getSetting).toHaveBeenCalledWith('stripe_webhook_secret');
  });
});
