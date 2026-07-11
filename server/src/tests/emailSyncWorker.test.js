const mockQuery = jest.fn();
jest.mock('../models/db', () => ({ query: (...args) => mockQuery(...args) }));

const {
  pauseActiveSequencesForInboundReplies,
  resolveOrgIdForUser,
} = require('../workers/emailSyncWorker');

describe('emailSyncWorker.resolveOrgIdForUser', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns the organization_id for a single membership', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ organization_id: 'org-resolved' }] });

    const orgId = await resolveOrgIdForUser('user-1');

    expect(orgId).toBe('org-resolved');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/organization_members/);
    expect(params).toEqual(['user-1']);
  });

  it('fails closed (throws) when the user has multiple memberships', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-1' }, { organization_id: 'org-2' }],
    });

    await expect(resolveOrgIdForUser('user-2')).rejects.toThrow('ambiguous');
  });

  it('fails closed (throws) when the user has no membership', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(resolveOrgIdForUser('user-3')).rejects.toThrow(
      'could not resolve organization_id'
    );
  });
});

describe('emailSyncWorker.pauseActiveSequencesForInboundReplies', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  const inboundReplyResult = {
    success: true,
    email: { is_outbound: false, sender_email: 'contact@example.com' },
    contact: { id: 'contact-1', email: 'contact@example.com' },
  };

  it('stamps organization_id on the activities INSERT when orgId is provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'enrollment-1' }] }) // UPDATE sequence_enrollments
      .mockResolvedValueOnce({ rows: [] }); // INSERT activities

    const summary = await pauseActiveSequencesForInboundReplies(
      'user-1',
      [inboundReplyResult],
      'org-1'
    );

    expect(summary).toEqual({ pausedEnrollments: 1, pausedContacts: 1 });
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toMatch(/INSERT INTO activities/);
    expect(insertSql).toMatch(/organization_id/);
    expect(insertParams[insertParams.length - 1]).toBe('org-1');
  });

  it('fails closed (throws, no queries run) when orgId is missing', async () => {
    await expect(
      pauseActiveSequencesForInboundReplies('user-1', [inboundReplyResult], undefined)
    ).rejects.toThrow('orgId is required');

    expect(mockQuery).not.toHaveBeenCalled();
  });
});
