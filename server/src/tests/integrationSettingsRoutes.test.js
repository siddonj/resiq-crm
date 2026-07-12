const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => (req, res, next) => {
  req.user = { id: 'user-1', email: 'admin@example.com', role: 'admin' };
  req.orgId = 'org-1';
  next();
});

jest.mock('../services/integrationSettings', () => ({
  getManagedCredentials: jest.fn(),
  updateManagedCredentials: jest.fn(),
  resolveWithOverride: jest.fn(),
}));

jest.mock('../services/auditLogger', () => ({ logAction: jest.fn() }));

jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    models: { list: jest.fn().mockResolvedValue({ data: [] }) },
  }))
);

const {
  getManagedCredentials,
  updateManagedCredentials,
  resolveWithOverride,
} = require('../services/integrationSettings');
const { logAction } = require('../services/auditLogger');
const router = require('../routes/integrationSettings');

describe('integration settings routes (GET/PUT)', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/integration-settings', router);

  beforeEach(() => jest.clearAllMocks());

  test('GET returns the managed credential list', async () => {
    getManagedCredentials.mockResolvedValue([{ key: 'openai_api_key', configured: false }]);

    const res = await request(app).get('/api/integration-settings');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ settings: [{ key: 'openai_api_key', configured: false }] });
  });

  test('PUT rejects a missing settings object', async () => {
    const res = await request(app).put('/api/integration-settings').send({});

    expect(res.status).toBe(400);
    expect(updateManagedCredentials).not.toHaveBeenCalled();
  });

  test('PUT saves credentials, logs the action, and returns the refreshed list', async () => {
    updateManagedCredentials.mockResolvedValue();
    getManagedCredentials.mockResolvedValue([{ key: 'openai_api_key', configured: true }]);

    const res = await request(app)
      .put('/api/integration-settings')
      .send({ settings: { openai_api_key: 'sk-new' } });

    expect(res.status).toBe(200);
    expect(updateManagedCredentials).toHaveBeenCalledWith({ openai_api_key: 'sk-new' }, 'user-1');
    expect(logAction).toHaveBeenCalledWith(
      'user-1',
      'admin@example.com',
      'update',
      'integration_credentials',
      null,
      'integration_settings',
      { updated_keys: ['openai_api_key'] },
      'org-1'
    );
    expect(res.body).toEqual({ settings: [{ key: 'openai_api_key', configured: true }] });
  });

  test('PUT returns 400 for an unsupported key', async () => {
    updateManagedCredentials.mockRejectedValue(new Error('Unsupported integration credential key: bogus'));

    const res = await request(app)
      .put('/api/integration-settings')
      .send({ settings: { bogus: 'x' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported integration credential key/);
  });
});

describe('integration settings routes (test-connection)', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/integration-settings', router);

  beforeEach(() => jest.clearAllMocks());

  test('returns 400 for an unknown provider', async () => {
    const res = await request(app).post('/api/integration-settings/unknown/test').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown provider/);
  });

  test('twilio: returns a validation error when credentials are missing', async () => {
    resolveWithOverride.mockResolvedValue(null);

    const res = await request(app).post('/api/integration-settings/twilio/test').send({ overrides: {} });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: 'Account SID and Auth Token are required' });
  });

  test('openai: succeeds when the resolved key works', async () => {
    resolveWithOverride.mockResolvedValue('sk-test');

    const res = await request(app)
      .post('/api/integration-settings/openai/test')
      .send({ overrides: { openai_api_key: 'sk-draft' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
