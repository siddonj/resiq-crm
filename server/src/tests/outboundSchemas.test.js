const {
  ImportCsvSchema,
  LeadFiltersSchema,
  CreateCampaignSchema,
  UpdateCampaignStatusSchema,
  SuppressionSchema,
  SaveGoalsSchema,
  WorkspaceConfigSchema,
} = require('../utils/outboundSchemas');

describe('outboundSchemas', () => {
  describe('ImportCsvSchema', () => {
    test('accepts valid input', () => {
      const result = ImportCsvSchema.safeParse({ sourceType: 'csv', sourceReference: 'test', sourceConfidence: 90 });
      expect(result.success).toBe(true);
      expect(result.data.sourceConfidence).toBe(90);
    });

    test('catches invalid sourceType', () => {
      const result = ImportCsvSchema.safeParse({ sourceType: 'invalid' });
      expect(result.success).toBe(false);
    });

    test('rejects sourceConfidence above 100', () => {
      const result = ImportCsvSchema.safeParse({ sourceConfidence: 150 });
      expect(result.success).toBe(false);
    });

    test('applies defaults', () => {
      const result = ImportCsvSchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data.sourceType).toBe('csv');
      expect(result.data.sourceConfidence).toBe(80);
    });
  });

  describe('LeadFiltersSchema', () => {
    test('accepts valid query params', () => {
      const result = LeadFiltersSchema.safeParse({ status: 'qualified', minScore: 50, limit: 50 });
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('qualified');
    });

    test('coerces string numbers', () => {
      const result = LeadFiltersSchema.safeParse({ minScore: '75', limit: '200' });
      expect(result.success).toBe(true);
      expect(result.data.minScore).toBe(75);
      expect(result.data.limit).toBe(200);
    });

    test('rejects invalid status', () => {
      const result = LeadFiltersSchema.safeParse({ status: 'invalid_status' });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateCampaignSchema', () => {
    test('accepts valid campaign', () => {
      const result = CreateCampaignSchema.safeParse({
        name: 'Summer Outreach',
        channels: ['email', 'linkedin'],
        leadIds: ['550e8400-e29b-41d4-a716-446655440000'],
      });
      expect(result.success).toBe(true);
    });

    test('rejects empty name', () => {
      const result = CreateCampaignSchema.safeParse({ name: '', channels: ['email'] });
      expect(result.success).toBe(false);
    });

    test('rejects empty channels', () => {
      const result = CreateCampaignSchema.safeParse({ name: 'Test', channels: [] });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateCampaignStatusSchema', () => {
    test('accepts valid status', () => {
      const result = UpdateCampaignStatusSchema.safeParse({ status: 'active' });
      expect(result.success).toBe(true);
    });

    test('rejects invalid status', () => {
      const result = UpdateCampaignStatusSchema.safeParse({ status: 'deleted' });
      expect(result.success).toBe(false);
    });
  });

  describe('SuppressionSchema', () => {
    test('accepts suppression with reason', () => {
      const result = SuppressionSchema.safeParse({ suppressed: true, reason: 'Unsubscribe' });
      expect(result.success).toBe(true);
    });

    test('accepts unsuppression without reason', () => {
      const result = SuppressionSchema.safeParse({ suppressed: false });
      expect(result.success).toBe(true);
    });
  });

  describe('SaveGoalsSchema', () => {
    test('accepts valid goals', () => {
      const result = SaveGoalsSchema.safeParse({
        periodType: 'monthly',
        targetMeetings: 10,
        targetOpportunities: 3,
        targetRevenue: 75000,
      });
      expect(result.success).toBe(true);
    });

    test('rejects negative numbers', () => {
      const result = SaveGoalsSchema.safeParse({
        periodType: 'weekly',
        targetMeetings: -1,
        targetOpportunities: 3,
        targetRevenue: 75000,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('WorkspaceConfigSchema', () => {
    test('accepts valid config', () => {
      const result = WorkspaceConfigSchema.safeParse({
        senderName: 'John Doe',
        dailyEmailLimit: 50,
        dailyLinkedinLimit: 20,
      });
      expect(result.success).toBe(true);
    });

    test('accepts empty object', () => {
      const result = WorkspaceConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test('rejects limit above max', () => {
      const result = WorkspaceConfigSchema.safeParse({ dailyEmailLimit: 2000 });
      expect(result.success).toBe(false);
    });
  });
});
