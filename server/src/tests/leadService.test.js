const leadService = require('../services/outbound/leadService');
const pool = require('../models/db');

jest.mock('../models/db');
jest.mock('../services/auditLogger', () => ({
  logAction: jest.fn(),
}));

describe('leadService importLeads integration', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    pool.connect = jest.fn().mockResolvedValue(mockClient);
    pool.query = jest.fn().mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('imports leads from CSV, computes dedupe keys, and applies scores', async () => {
    const csv = `name,email,company,title
Alice Smith,alice@example.com,Acme Inc,Director
Bob Jones,bob@example.com,Acme Inc,Manager`;

    const file = {
      originalname: 'test.csv',
      buffer: Buffer.from(csv, 'utf8'),
    };

    // First call: create import job
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'job-1' }] })
      .mockResolvedValueOnce({ rows: [] }); // update job status

    // Inside transaction: no existing leads for dedupe check, inserts return IDs
    let insertIdCounter = 0;
    mockClient.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO outbound_leads')) {
        insertIdCounter++;
        return { rows: [{ id: `lead-${insertIdCounter}` }] };
      }
      if (typeof sql === 'string' && sql.includes('SELECT id FROM outbound_leads')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await leadService.importLeads({
      userId: 'user-1',
      file,
      importConfig: { sourceType: 'csv', sourceReference: 'test', sourceConfidence: 80 },
    });

    expect(result.status).toBe('completed');
    expect(result.totalRows).toBe(2);
    expect(result.importedRows).toBe(2);
    expect(result.duplicateRows).toBe(0);
    expect(result.failedRows).toBe(0);

    // Verify scoring columns were included in INSERT
    const insertCalls = mockClient.query.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO outbound_leads')
    );
    expect(insertCalls.length).toBe(2);

    const firstInsertArgs = insertCalls[0][1];
    // Args indices: 0=userId, 1=sourceType, 2=sourceReference, 3=sourceConfidence, 4=name, 5=first_name, 6=last_name, 7=email, 8=phone, 9=company, 10=title, 11=linkedin_url, 12=website, 13=location, 14=notes, 15=raw_data, 16=dedupe_key, 17=fit_score, 18=intent_score, 19=total_score, 20=status, 21=next_recommended_action
    expect(firstInsertArgs[16]).toBeTruthy(); // dedupe_key
    expect(typeof firstInsertArgs[17]).toBe('number'); // fit_score
    expect(typeof firstInsertArgs[18]).toBe('number'); // intent_score
    expect(typeof firstInsertArgs[19]).toBe('number'); // total_score
    expect(typeof firstInsertArgs[20]).toBe('string'); // status
    expect(firstInsertArgs[21]).toBeTruthy(); // next_recommended_action
  });

  test('skips duplicate leads based on dedupe key', async () => {
    const csv = `name,email,company,title
Alice Smith,alice@example.com,Acme Inc,Director`;

    const file = {
      originalname: 'dupes.csv',
      buffer: Buffer.from(csv, 'utf8'),
    };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'job-2' }] })
      .mockResolvedValueOnce({ rows: [] });

    // Simulate existing lead with same dedupe key
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('SELECT id FROM outbound_leads')) {
        return { rows: [{ id: 'existing-lead-1' }] };
      }
      return { rows: [] };
    });

    const result = await leadService.importLeads({
      userId: 'user-1',
      file,
      importConfig: { sourceType: 'csv', sourceReference: 'test', sourceConfidence: 80 },
    });

    expect(result.status).toBe('completed');
    expect(result.totalRows).toBe(1);
    expect(result.importedRows).toBe(0);
    expect(result.duplicateRows).toBe(1);
    expect(result.failedRows).toBe(0);

    // Should not have called INSERT INTO outbound_leads
    const insertCalls = mockClient.query.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO outbound_leads')
    );
    expect(insertCalls.length).toBe(0);
  });

  test('fails gracefully for rows missing required name', async () => {
    const csv = `name,email,company,title
,alice@example.com,Acme Inc,Director`;

    const file = {
      originalname: 'bad.csv',
      buffer: Buffer.from(csv, 'utf8'),
    };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'job-3' }] })
      .mockResolvedValueOnce({ rows: [] });

    mockClient.query.mockResolvedValue({ rows: [] });

    const result = await leadService.importLeads({
      userId: 'user-1',
      file,
      importConfig: { sourceType: 'csv', sourceReference: 'test', sourceConfidence: 80 },
    });

    expect(result.status).toBe('completed');
    expect(result.totalRows).toBe(1);
    expect(result.importedRows).toBe(0);
    expect(result.failedRows).toBe(1);
    expect(result.errorSample.length).toBeGreaterThan(0);
    expect(result.errorSample[0].error).toMatch(/missing name/i);
  });
});
