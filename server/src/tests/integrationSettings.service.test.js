process.env.ENCRYPTION_KEY = 'a'.repeat(32);

jest.mock('../models/db', () => ({ query: jest.fn() }));

const pool = require('../models/db');
const {
  getSetting,
  getManagedCredentials,
  updateManagedCredentials,
  resolveWithOverride,
} = require('../services/integrationSettings');

describe('integrationSettings service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.OPENAI_API_KEY;
  });

  test('getSetting falls back to the env var when no DB row exists', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    process.env.TWILIO_ACCOUNT_SID = 'ACenvvalue';

    const value = await getSetting('twilio_account_sid');

    expect(value).toBe('ACenvvalue');
  });

  test('getSetting returns null when neither DB nor env is set', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const value = await getSetting('openai_api_key');

    expect(value).toBeNull();
  });

  test('updateManagedCredentials encrypts secret fields before persisting', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // INSERT ... ON CONFLICT
    pool.query.mockResolvedValueOnce({ rows: [] }); // refresh read in getManagedCredentials

    await updateManagedCredentials({ openai_api_key: 'sk-test-12345' }, 'user-1');

    const insertCall = pool.query.mock.calls[0];
    expect(insertCall[0]).toMatch(/INSERT INTO integration_credentials/);
    const storedValue = insertCall[1][1];
    expect(storedValue).not.toBe('sk-test-12345');
    expect(storedValue.split(':')).toHaveLength(3); // iv:encrypted:authTag
  });

  test('updateManagedCredentials rejects unknown keys', async () => {
    await expect(updateManagedCredentials({ bogus_key: 'x' }, 'user-1')).rejects.toThrow(
      'Unsupported integration credential key: bogus_key'
    );
  });

  test('getManagedCredentials masks secret values and never returns the raw value', async () => {
    const tokenManager = require('../services/oauth');
    pool.query.mockResolvedValue({
      rows: [
        {
          credential_key: 'stripe_secret_key',
          credential_value: tokenManager.encrypt('sk_live_abcd1234'),
          updated_at: null,
          updated_by: null,
        },
      ],
    });

    const settings = await getManagedCredentials();
    const stripeKey = settings.find((s) => s.key === 'stripe_secret_key');

    expect(stripeKey.value).toBeUndefined();
    expect(stripeKey.configured).toBe(true);
    expect(stripeKey.maskedValue).toBe('••••1234');
  });

  test('resolveWithOverride prefers the override value over the saved value', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    process.env.OPENAI_API_KEY = 'sk-env-value';

    const value = await resolveWithOverride('openai_api_key', { openai_api_key: 'sk-draft-value' });

    expect(value).toBe('sk-draft-value');
  });
});
