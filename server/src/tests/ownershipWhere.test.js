const { ownershipWhere } = require('../db');

describe('ownershipWhere — fail closed on missing org', () => {
  it.each(['admin', 'manager', 'user', 'viewer'])(
    'throws when orgId is missing for role %s',
    (role) => {
      expect(() => ownershipWhere('d', 'deal', 'user-1', role, null)).toThrow(
        /organization/i
      );
      expect(() => ownershipWhere('d', 'deal', 'user-1', role, undefined)).toThrow(
        /organization/i
      );
    }
  );

  it('admin path does not throw and returns a predicate when orgId is present', () => {
    expect(() => ownershipWhere('d', 'deal', 'user-1', 'admin', 'org-1')).not.toThrow();
    expect(ownershipWhere('d', 'deal', 'user-1', 'admin', 'org-1')).toBeTruthy();
  });
});
