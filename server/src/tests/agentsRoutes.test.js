process.env.ENCRYPTION_KEY = 'a'.repeat(32);

const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => (req, res, next) => {
  req.user = { id: 'user-1', email: 'owner@example.com' };
  next();
});

jest.mock('../services/agentService', () => ({
  generateProspects: jest.fn(),
}));

jest.mock('../services/agentProspectService', () => ({
  importProspects: jest.fn(),
}));

// isOpenAiConfigured()/getOpenAiClient() resolve credentials via integrationSettings,
// which queries integration_credentials through this pool before falling back to env.
// Mock it to return no rows so the OPENAI_API_KEY env fallback set below is used,
// instead of attempting a real DB connection.
jest.mock('../models/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

const { generateProspects } = require('../services/agentService');
const { importProspects } = require('../services/agentProspectService');
const router = require('../routes/agents');

describe('agent prospect routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', router);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  test('returns generated prospects for review', async () => {
    generateProspects.mockResolvedValue([
      { name: 'Pat Lee', company: 'Acme Property Group', email: 'pat@acme.com' },
    ]);

    const res = await request(app)
      .post('/api/agents/prospect')
      .set('Authorization', 'Bearer token')
      .send({ prompt: 'Find property management companies' });

    expect(res.status).toBe(200);
    expect(generateProspects).toHaveBeenCalledWith('Find property management companies');
    expect(res.body).toEqual({
      prospects: [{ name: 'Pat Lee', company: 'Acme Property Group', email: 'pat@acme.com' }],
    });
  });

  test('imports only the selected prospects', async () => {
    importProspects.mockResolvedValue([
      { id: 'contact-1', name: 'Pat Lee', company: 'Acme Property Group' },
    ]);

    const prospects = [
      { name: 'Pat Lee', company: 'Acme Property Group', email: 'pat@acme.com' },
    ];

    const res = await request(app)
      .post('/api/agents/prospect/import')
      .set('Authorization', 'Bearer token')
      .send({ prompt: 'Find property management companies', prospects });

    expect(res.status).toBe(201);
    expect(importProspects).toHaveBeenCalledWith({
      userId: 'user-1',
      auditActor: 'owner@example.com',
      prompt: 'Find property management companies',
      prospects,
    });
    expect(res.body).toEqual({
      importedCount: 1,
      contacts: [{ id: 'contact-1', name: 'Pat Lee', company: 'Acme Property Group' }],
    });
  });

  test('rejects empty prospect imports', async () => {
    const res = await request(app)
      .post('/api/agents/prospect/import')
      .set('Authorization', 'Bearer token')
      .send({ prospects: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'At least one prospect is required' });
    expect(importProspects).not.toHaveBeenCalled();
  });
});
