const mockQuery = jest.fn();
jest.mock('../models/db', () => ({ query: (...args) => mockQuery(...args) }));

const { logAction } = require('../services/auditLogger');

// logAction fires the INSERT asynchronously (fire-and-forget). Flush
// microtasks after each call so the mocked pool.query has been invoked
// before we assert on it.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('logAction', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it('includes organization_id in the audit_logs INSERT when orgId is provided', async () => {
    logAction('user-1', 'user@example.com', 'create', 'contact', 'contact-1', 'Jane Doe', { foo: 'bar' }, 'org-1');
    await flush();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sqlText, params] = mockQuery.mock.calls[0];

    expect(sqlText).toMatch(/INSERT INTO audit_logs/);
    expect(sqlText).toMatch(/organization_id/);
    // organization_id is the last bound param ($8) — assert it's present and correct.
    expect(params).toContain('org-1');
    expect(params[params.length - 1]).toBe('org-1');
  });

  it('resolves organization_id via membership lookup when orgId is omitted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ organization_id: 'org-resolved' }] }) // membership lookup
      .mockResolvedValueOnce({ rows: [] }); // audit_logs insert

    logAction('user-2', 'user2@example.com', 'user_login', 'user', 'user-2', 'User Two');
    await flush();
    await flush();

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [membershipSql, membershipParams] = mockQuery.mock.calls[0];
    expect(membershipSql).toMatch(/organization_members/);
    expect(membershipParams).toEqual(['user-2']);

    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toMatch(/INSERT INTO audit_logs/);
    expect(insertParams[insertParams.length - 1]).toBe('org-resolved');
  });

  it('fails closed (does not insert with a null organization_id) when resolution is ambiguous', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-1' }, { organization_id: 'org-2' }],
    });

    logAction('user-3', 'user3@example.com', 'user_login', 'user', 'user-3', 'User Three');
    await flush();

    // Only the membership lookup should have run — the INSERT must never fire
    // with an unresolved/null organization_id.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      'Audit log error:',
      expect.stringContaining('ambiguous')
    );
  });

  it('fails closed (does not insert) when the user has no organization membership at all', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    logAction('user-4', 'user4@example.com', 'user_login', 'user', 'user-4', 'User Four');
    await flush();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      'Audit log error:',
      expect.stringContaining('could not resolve organization_id')
    );
  });
});
