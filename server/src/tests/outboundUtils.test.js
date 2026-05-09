const {
  parseCSVRow,
  normalizeHeader,
  parseCSV,
  canonicalLinkedInUrl,
  buildLeadFromRow,
  computeDedupeKey,
  buildEmailDraft,
  buildLinkedInDraft,
  csvEscape,
  toFiniteNumber,
  safeRate,
  round2,
  isPlainObject,
  getByPath,
  compareConditionValues,
  evaluateRuleConditions,
  normalizeRuleActions,
  getCurrentPeriodWindow,
  calculatePeriodProgress,
  normalizeCampaignChannels,
  sanitizeUuidValue,
  classifyPersonaTitle,
  VALID_OUTBOUND_LEAD_STATUSES,
  VALID_RULE_ACTION_TYPES,
} = require('../utils/outboundUtils');

describe('outboundUtils', () => {
  describe('parseCSVRow', () => {
    test('parses simple comma-separated values', () => {
      expect(parseCSVRow('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    test('handles quoted values with commas', () => {
      expect(parseCSVRow('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
    });

    test('handles escaped quotes', () => {
      expect(parseCSVRow('a,"b""c",d')).toEqual(['a', 'b"c', 'd']);
    });

    test('handles empty cells', () => {
      expect(parseCSVRow('a,,c')).toEqual(['a', '', 'c']);
    });

    test('trims whitespace', () => {
      expect(parseCSVRow('  a  ,  b  ,  c  ')).toEqual(['a', 'b', 'c']);
    });
  });

  describe('normalizeHeader', () => {
    test('lowercases and replaces spaces/hyphens with underscores', () => {
      expect(normalizeHeader('First Name')).toBe('first_name');
      expect(normalizeHeader('Email Address')).toBe('email_address');
      expect(normalizeHeader('LinkedIn-URL')).toBe('linkedin_url');
    });

    test('removes non-word characters', () => {
      expect(normalizeHeader('Company (HQ)')).toBe('company_hq');
    });
  });

  describe('parseCSV', () => {
    test('returns empty array for single-line CSV', () => {
      expect(parseCSV('name')).toEqual([]);
    });

    test('parses multi-line CSV into objects', () => {
      const result = parseCSV('name,email\nJohn Doe,john@example.com\nJane Doe,jane@example.com');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'John Doe', email: 'john@example.com' });
      expect(result[1]).toEqual({ name: 'Jane Doe', email: 'jane@example.com' });
    });

    test('ignores empty lines', () => {
      const result = parseCSV('name,email\n\nJohn Doe,john@example.com\n\n');
      expect(result).toHaveLength(1);
    });
  });

  describe('canonicalLinkedInUrl', () => {
    test('normalizes full URLs', () => {
      expect(canonicalLinkedInUrl('https://www.linkedin.com/in/johndoe/')).toBe('https://www.linkedin.com/in/johndoe');
    });

    test('adds https if missing', () => {
      expect(canonicalLinkedInUrl('linkedin.com/in/johndoe')).toBe('https://linkedin.com/in/johndoe');
    });

    test('removes query params and hash', () => {
      expect(canonicalLinkedInUrl('https://linkedin.com/in/johndoe?ref=home')).toBe('https://linkedin.com/in/johndoe');
    });

    test('returns null for empty input', () => {
      expect(canonicalLinkedInUrl('')).toBeNull();
      expect(canonicalLinkedInUrl(null)).toBeNull();
    });
  });

  describe('buildLeadFromRow', () => {
    test('combines first_name and last_name', () => {
      const row = { first_name: 'John', last_name: 'Doe', email: 'john@example.com' };
      const lead = buildLeadFromRow(row);
      expect(lead.name).toBe('John Doe');
      expect(lead.email).toBe('john@example.com');
    });

    test('prefers explicit name field', () => {
      const row = { name: 'Full Name', first_name: 'John', last_name: 'Doe' };
      const lead = buildLeadFromRow(row);
      expect(lead.name).toBe('Full Name');
    });

    test('falls back to Unknown', () => {
      const lead = buildLeadFromRow({});
      expect(lead.name).toBe('Unknown');
    });

    test('normalizes email to lowercase', () => {
      const lead = buildLeadFromRow({ email: 'John@Example.COM' });
      expect(lead.email).toBe('john@example.com');
    });
  });

  describe('computeDedupeKey', () => {
    test('uses email when available', () => {
      expect(computeDedupeKey({ email: 'john@example.com' })).toBe('email:john@example.com');
    });

    test('falls back to linkedin_url', () => {
      expect(computeDedupeKey({ linkedin_url: 'https://linkedin.com/in/john' })).toBe('linkedin:https://linkedin.com/in/john');
    });

    test('falls back to name+company', () => {
      expect(computeDedupeKey({ name: 'John Doe', company: 'Acme' })).toBe('name_company:john doe|acme');
    });
  });

  describe('buildEmailDraft', () => {
    test('includes first name and company', () => {
      const draft = buildEmailDraft({ first_name: 'John', company: 'Acme Inc' });
      expect(draft.subject).toContain('Acme Inc');
      expect(draft.body).toContain('Hi John');
    });

    test('handles missing first_name', () => {
      const draft = buildEmailDraft({ name: 'John Doe', company: 'Acme' });
      expect(draft.body).toContain('Hi John');
    });
  });

  describe('buildLinkedInDraft', () => {
    test('includes first name and company', () => {
      const draft = buildLinkedInDraft({ first_name: 'John', company: 'Acme' });
      expect(draft).toContain('Hi John');
      expect(draft).toContain('Acme');
    });
  });

  describe('csvEscape', () => {
    test('wraps in quotes and escapes internal quotes', () => {
      expect(csvEscape('say "hello"')).toBe('"say ""hello"""');
    });

    test('handles null/undefined', () => {
      expect(csvEscape(null)).toBe('""');
      expect(csvEscape(undefined)).toBe('""');
    });
  });

  describe('toFiniteNumber', () => {
    test('returns number for valid input', () => {
      expect(toFiniteNumber(42)).toBe(42);
      expect(toFiniteNumber('3.14')).toBe(3.14);
    });

    test('returns fallback for invalid input', () => {
      expect(toFiniteNumber('abc', 0)).toBe(0);
      expect(toFiniteNumber(NaN, 5)).toBe(5);
      expect(toFiniteNumber(Infinity, 5)).toBe(5);
    });
  });

  describe('safeRate', () => {
    test('calculates percentage rate', () => {
      expect(safeRate(25, 100)).toBe(25);
      expect(safeRate(1, 3)).toBe(33.33);
    });

    test('returns 0 for zero denominator', () => {
      expect(safeRate(10, 0)).toBe(0);
    });
  });

  describe('round2', () => {
    test('rounds to 2 decimal places', () => {
      expect(round2(3.14159)).toBe(3.14);
      expect(round2(2.5)).toBe(2.5);
    });
  });

  describe('isPlainObject', () => {
    test('returns true for plain objects', () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ a: 1 })).toBe(true);
    });

    test('returns false for arrays and null', () => {
      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject(null)).toBe(false);
      expect(isPlainObject('string')).toBe(false);
    });
  });

  describe('getByPath', () => {
    test('gets nested values', () => {
      expect(getByPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
      expect(getByPath({ a: { b: 2 } }, 'a.b')).toBe(2);
    });

    test('returns undefined for missing paths', () => {
      expect(getByPath({ a: 1 }, 'a.b.c')).toBeUndefined();
      expect(getByPath({}, 'foo')).toBeUndefined();
    });
  });

  describe('compareConditionValues', () => {
    test('supports equality', () => {
      expect(compareConditionValues('equals', 'a', 'a')).toBe(true);
      expect(compareConditionValues('eq', 'a', 'a')).toBe(true);
      expect(compareConditionValues('equals', 'a', 'b')).toBe(false);
    });

    test('supports numeric comparisons', () => {
      expect(compareConditionValues('gt', 10, 5)).toBe(true);
      expect(compareConditionValues('gte', 5, 5)).toBe(true);
      expect(compareConditionValues('lt', 3, 5)).toBe(true);
      expect(compareConditionValues('lte', 5, 5)).toBe(true);
    });

    test('supports contains', () => {
      expect(compareConditionValues('contains', 'Hello World', 'world')).toBe(true);
      expect(compareConditionValues('contains', 'Hello', 'xyz')).toBe(false);
    });

    test('supports exists', () => {
      expect(compareConditionValues('exists', 'value', undefined)).toBe(true);
      expect(compareConditionValues('exists', '', undefined)).toBe(false);
      expect(compareConditionValues('exists', null, undefined)).toBe(false);
    });
  });

  describe('evaluateRuleConditions', () => {
    test('returns true for empty conditions', () => {
      expect(evaluateRuleConditions({}, {})).toBe(true);
      expect(evaluateRuleConditions(null, {})).toBe(true);
    });

    test('evaluates AND conditions', () => {
      const conditions = {
        operator: 'AND',
        rules: [
          { field: 'lead.status', op: 'equals', value: 'new' },
          { field: 'lead.total_score', op: 'gte', value: 50 },
        ],
      };
      expect(evaluateRuleConditions(conditions, { lead: { status: 'new', total_score: 60 } })).toBe(true);
      expect(evaluateRuleConditions(conditions, { lead: { status: 'new', total_score: 40 } })).toBe(false);
    });

    test('evaluates OR conditions', () => {
      const conditions = {
        operator: 'OR',
        rules: [
          { field: 'lead.status', op: 'equals', value: 'new' },
          { field: 'lead.status', op: 'equals', value: 'qualified' },
        ],
      };
      expect(evaluateRuleConditions(conditions, { lead: { status: 'qualified' } })).toBe(true);
      expect(evaluateRuleConditions(conditions, { lead: { status: 'contacted' } })).toBe(false);
    });
  });

  describe('normalizeRuleActions', () => {
    test('filters invalid action types', () => {
      const actions = [
        { type: 'update_lead_status', config: { status: 'qualified' } },
        { type: 'invalid_action', config: {} },
        { type: 'suppress_lead', config: { reason: 'test' } },
      ];
      const normalized = normalizeRuleActions(actions);
      expect(normalized).toHaveLength(2);
      expect(normalized[0].type).toBe('update_lead_status');
      expect(normalized[1].type).toBe('suppress_lead');
    });

    test('returns empty array for non-array input', () => {
      expect(normalizeRuleActions(null)).toEqual([]);
      expect(normalizeRuleActions('string')).toEqual([]);
    });
  });

  describe('getCurrentPeriodWindow', () => {
    test('returns monthly window by default', () => {
      const window = getCurrentPeriodWindow('monthly');
      expect(window.periodType).toBe('monthly');
      expect(window.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(window.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('returns weekly window', () => {
      const window = getCurrentPeriodWindow('weekly');
      expect(window.periodType).toBe('weekly');
      expect(window.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('calculatePeriodProgress', () => {
    test('calculates progress for a 7-day period', () => {
      const progress = calculatePeriodProgress('2026-01-01', '2026-01-07');
      expect(progress.totalDays).toBe(7);
      expect(progress.completionRatio).toBeGreaterThanOrEqual(0);
      expect(progress.completionRatio).toBeLessThanOrEqual(1);
    });
  });

  describe('normalizeCampaignChannels', () => {
    test('defaults to email', () => {
      expect(normalizeCampaignChannels([])).toEqual(['email']);
      expect(normalizeCampaignChannels(null)).toEqual(['email']);
    });

    test('filters invalid channels', () => {
      expect(normalizeCampaignChannels(['email', 'linkedin', 'sms'])).toEqual(['email', 'linkedin']);
    });

    test('deduplicates', () => {
      expect(normalizeCampaignChannels(['email', 'email', 'linkedin'])).toEqual(['email', 'linkedin']);
    });
  });

  describe('sanitizeUuidValue', () => {
    test('returns valid UUID unchanged', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(sanitizeUuidValue(uuid)).toBe(uuid);
    });

    test('returns null for invalid UUIDs', () => {
      expect(sanitizeUuidValue('not-a-uuid')).toBeNull();
      expect(sanitizeUuidValue('')).toBeNull();
      expect(sanitizeUuidValue(null)).toBeNull();
    });
  });

  describe('classifyPersonaTitle', () => {
    test('classifies executive titles', () => {
      expect(classifyPersonaTitle('Chief Technology Officer')).toBe('Executive');
      expect(classifyPersonaTitle('CEO')).toBe('Executive');
    });

    test('classifies VP titles', () => {
      expect(classifyPersonaTitle('VP of Sales')).toBe('VP');
      expect(classifyPersonaTitle('Vice President')).toBe('VP');
    });

    test('classifies director titles', () => {
      expect(classifyPersonaTitle('Director of Engineering')).toBe('Director');
    });

    test('classifies manager titles', () => {
      expect(classifyPersonaTitle('Sales Manager')).toBe('Manager');
    });

    test('returns Unknown for empty titles', () => {
      expect(classifyPersonaTitle('')).toBe('Unknown');
      expect(classifyPersonaTitle(null)).toBe('Unknown');
    });
  });
});
