process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-compliance';

const compliance = require('../services/outbound/complianceService');

describe('complianceService pure helpers', () => {
  test('normalizeEmail lowercases and trims', () => {
    expect(compliance.normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(compliance.normalizeEmail(null)).toBe('');
  });

  test('domainOf extracts the domain', () => {
    expect(compliance.domainOf('a@Example.com')).toBe('example.com');
    expect(compliance.domainOf('not-an-email')).toBe('');
  });

  test('isValidEmail', () => {
    expect(compliance.isValidEmail('a@b.co')).toBe(true);
    expect(compliance.isValidEmail('nope')).toBe(false);
    expect(compliance.isValidEmail('a@b')).toBe(false);
  });

  test('unsubscribe token round-trips', () => {
    const token = compliance.generateUnsubscribeToken('user-123', 'Lead@Example.com');
    const decoded = compliance.verifyUnsubscribeToken(token);
    expect(decoded).toEqual({ userId: 'user-123', email: 'lead@example.com' });
  });

  test('tampered token is rejected', () => {
    const token = compliance.generateUnsubscribeToken('user-123', 'lead@example.com');
    const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');
    expect(compliance.verifyUnsubscribeToken(tampered)).toBeNull();
    expect(compliance.verifyUnsubscribeToken('garbage')).toBeNull();
    expect(compliance.verifyUnsubscribeToken('')).toBeNull();
  });

  test('buildComplianceFooter includes address and unsubscribe url', () => {
    const footer = compliance.buildComplianceFooter({
      config: { unsubscribe_footer_enabled: true, physical_mailing_address: '123 Main St, City' },
      url: 'https://app.example.com/api/unsubscribe/tok',
    });
    expect(footer).toContain('123 Main St, City');
    expect(footer).toContain('Unsubscribe: https://app.example.com/api/unsubscribe/tok');
  });

  test('buildComplianceFooter is empty when disabled', () => {
    expect(
      compliance.buildComplianceFooter({
        config: { unsubscribe_footer_enabled: false, physical_mailing_address: '123 Main St' },
        url: 'https://x/api/unsubscribe/tok',
      })
    ).toBe('');
  });
});
