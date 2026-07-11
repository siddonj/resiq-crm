const mockQuery = jest.fn();
jest.mock('../models/db', () => ({ query: (...args) => mockQuery(...args) }));

const emailMatcher = require('../services/emailMatcher');

describe('emailMatcher.matchEmailToContact', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
    console.log.mockRestore();
  });

  it('stamps organization_id on the contacts INSERT when orgId is provided', async () => {
    // findContactByEmail lookup finds nothing, then the INSERT returns a new row.
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // findContactByEmail(sender)
      .mockResolvedValueOnce({ rows: [{ id: 'contact-1', name: 'jane', email: 'jane@example.com' }] }); // INSERT

    const contact = await emailMatcher.matchEmailToContact(
      'user-1',
      'jane@example.com',
      [],
      'org-1'
    );

    expect(contact).toEqual({ id: 'contact-1', name: 'jane', email: 'jane@example.com' });
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toMatch(/INSERT INTO contacts/);
    expect(insertSql).toMatch(/organization_id/);
    expect(insertParams).toEqual(['user-1', 'jane', 'jane@example.com', 'prospect', 'org-1']);
  });

  it('fails closed (no INSERT executed, contact is null) when orgId is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // findContactByEmail(sender) finds nothing

    const contact = await emailMatcher.matchEmailToContact(
      'user-1',
      'jane@example.com',
      [],
      undefined
    );

    expect(contact).toBeNull();
    // Only the lookup query ran — the INSERT must never fire without orgId.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create/find contact'),
      expect.stringContaining('orgId is required')
    );
  });

  it('returns an existing contact without needing orgId when one is already matched', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'contact-existing', name: 'jane', email: 'jane@example.com' }],
    });

    const contact = await emailMatcher.matchEmailToContact(
      'user-1',
      'jane@example.com',
      [],
      undefined
    );

    expect(contact).toEqual({ id: 'contact-existing', name: 'jane', email: 'jane@example.com' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
