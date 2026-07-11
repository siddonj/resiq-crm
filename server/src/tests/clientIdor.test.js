jest.mock('../models/db', () => ({ query: jest.fn() }));

const pool = require('../models/db');
const Client = require('../models/client');

describe('Client.findById — org scoped', () => {
  it('includes organization_id in the query and passes orgId param', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await Client.findById('client-1', 'org-1');
    const [sqlText, params] = pool.query.mock.calls[0];
    expect(sqlText).toMatch(/organization_id\s*=\s*\$2/i);
    expect(params).toEqual(['client-1', 'org-1']);
  });

  it('throws when orgId is omitted, without running a query', async () => {
    pool.query.mockClear();
    await expect(Client.findById('client-1')).rejects.toThrow();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('throws when orgId is explicitly null or undefined', async () => {
    pool.query.mockClear();
    await expect(Client.findById('client-1', null)).rejects.toThrow();
    await expect(Client.findById('client-1', undefined)).rejects.toThrow();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
