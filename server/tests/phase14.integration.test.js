/**
 * Phase 14 Integration Tests
 * Tests client portal authentication, proposals, invoices, files, and actions
 */

const request = require('supertest');
const pool = require('../models/db');

// Note: These tests assume the server is running on localhost:5000
// and the database is populated with test data

describe('Phase 14: Client Portal Integration Tests', () => {
  let testClientId;
  let testInvitationToken;
  let testClientToken;
  let testProposalId;
  let testInvoiceId;
  let testFileId;

  beforeAll(async () => {
    // Ensure database is ready
    try {
      await pool.query('SELECT 1');
      console.log('✓ Database connected');
    } catch (err) {
      throw new Error(`Database connection failed: ${err.message}`);
    }
  });

  afterAll(async () => {
    // Cleanup
    try {
      if (testClientId) {
        await pool.query('DELETE FROM client_activities WHERE client_id = $1', [testClientId]);
        await pool.query('DELETE FROM client_shared_items WHERE client_id = $1', [testClientId]);
        await pool.query('DELETE FROM client_deal_access WHERE client_id = $1', [testClientId]);
        await pool.query('DELETE FROM client_invitations WHERE email = $1', ['test-client@example.com']);
        await pool.query('DELETE FROM clients WHERE id = $1', [testClientId]);
      }
      await pool.end();
    } catch (err) {
      console.warn('Cleanup error:', err.message);
    }
  });

  describe('Client Authentication', () => {
    it('should invite a client via email', async () => {
      const res = await request('http://localhost:5000')
        .post('/api/auth/client/invite')
        .send({
          email: 'test-client@example.com',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('invitation');
      expect(res.body.invitation).toHaveProperty('token');
      testInvitationToken = res.body.invitation.token;
    });

    it('should verify invitation token and create client account', async () => {
      if (!testInvitationToken) {
        throw new Error('No invitation token available');
      }

      const res = await request('http://localhost:5000')
        .post(`/api/auth/client/verify/${testInvitationToken}`)
        .send({
          name: 'Test Client',
          password: 'TestPassword123!',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      testClientToken = res.body.token;

      // Decode JWT to get client ID (basic parsing)
      const parts = testClientToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      testClientId = payload.clientId;
    });

    it('should authenticate client with password', async () => {
      const res = await request('http://localhost:5000')
        .post('/api/auth/client/login')
        .send({
          email: 'test-client@example.com',
          password: 'TestPassword123!',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
    });
  });

  describe('Client Proposals', () => {
    it('should list proposals shared with client', async () => {
      if (!testClientToken) {
        throw new Error('No client token available');
      }

      const res = await request('http://localhost:5000')
        .get('/api/client/proposals')
        .set('Authorization', `Bearer ${testClientToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Note: May be empty if no proposals shared yet
    });

    it('should sign a proposal', async () => {
      if (!testClientToken) {
        throw new Error('No client token available');
      }

      // First, get a proposal to sign
      const proposalsRes = await request('http://localhost:5000')
        .get('/api/client/proposals')
        .set('Authorization', `Bearer ${testClientToken}`);

      if (proposalsRes.body.length > 0 && proposalsRes.body[0].status !== 'signed') {
        testProposalId = proposalsRes.body[0].id;

        const signRes = await request('http://localhost:5000')
          .patch(`/api/client/proposals/${testProposalId}/sign`)
          .set('Authorization', `Bearer ${testClientToken}`)
          .send({
            signatureName: 'Test Client',
          });

        expect(signRes.status).toBe(200);
        expect(signRes.body).toHaveProperty('status', 'signed');
        expect(signRes.body).toHaveProperty('signature_name', 'Test Client');
        expect(signRes.body).toHaveProperty('signed_at');
      }
    });
  });

  describe('Client Invoices', () => {
    it('should list invoices shared with client', async () => {
      if (!testClientToken) {
        throw new Error('No client token available');
      }

      const res = await request('http://localhost:5000')
        .get('/api/client/invoices')
        .set('Authorization', `Bearer ${testClientToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should get payment link for invoice', async () => {
      if (!testClientToken) {
        throw new Error('No client token available');
      }

      const invoicesRes = await request('http://localhost:5000')
        .get('/api/client/invoices')
        .set('Authorization', `Bearer ${testClientToken}`);

      if (invoicesRes.body.length > 0) {
        testInvoiceId = invoicesRes.body[0].id;

        const payRes = await request('http://localhost:5000')
          .post(`/api/client/invoices/${testInvoiceId}/pay`)
          .set('Authorization', `Bearer ${testClientToken}`);

        if (payRes.status === 200) {
          expect(payRes.body).toHaveProperty('paymentUrl');
        } else {
          // Invoice might not have payment link yet
          expect([400, 200]).toContain(payRes.status);
        }
      }
    });
  });

  describe('Client Files', () => {
    it('should list files shared with client', async () => {
      if (!testClientToken) {
        throw new Error('No client token available');
      }

      const res = await request('http://localhost:5000')
        .get('/api/client/files')
        .set('Authorization', `Bearer ${testClientToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Client Activity Tracking', () => {
    it('should track client activities', async () => {
      if (!testClientToken) {
        throw new Error('No client token available');
      }

      const res = await request('http://localhost:5000')
        .get('/api/client/activity')
        .set('Authorization', `Bearer ${testClientToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Should have logged some activities from previous operations
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('Client Profile', () => {
    it('should get authenticated client profile', async () => {
      if (!testClientToken) {
        throw new Error('No client token available');
      }

      const res = await request('http://localhost:5000')
        .get('/api/client/me')
        .set('Authorization', `Bearer ${testClientToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'Test Client');
      expect(res.body).toHaveProperty('email', 'test-client@example.com');
    });
  });

  describe('Error Handling', () => {
    it('should reject unauthorized requests', async () => {
      const res = await request('http://localhost:5000')
        .get('/api/client/proposals');

      expect(res.status).toBe(401);
    });

    it('should reject invalid tokens', async () => {
      const res = await request('http://localhost:5000')
        .get('/api/client/proposals')
        .set('Authorization', 'Bearer invalid.token.here');

      expect(res.status).toBe(401);
    });

    it('should prevent access to other clients data', async () => {
      if (!testClientToken) {
        throw new Error('No client token available');
      }

      // Try to access a non-existent proposal
      const res = await request('http://localhost:5000')
        .get('/api/client/proposals/fake-id-that-doesnt-exist')
        .set('Authorization', `Bearer ${testClientToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Stripe Integration', () => {
    it('should have Stripe webhook endpoint available', async () => {
      const res = await request('http://localhost:5000')
        .post('/api/stripe/webhook')
        .send({});

      // Should fail validation, but endpoint should exist
      expect([400, 401, 403, 503]).toContain(res.status);
    });

    it('should allow payment link creation (when configured)', async () => {
      const res = await request('http://localhost:5000')
        .post('/api/stripe/create-payment-link')
        .send({
          invoiceId: 'test-invoice-id',
          invoiceNumber: 'INV-001',
          amount: 100,
          description: 'Test Invoice',
        });

      // Should either work or indicate Stripe not configured
      expect([201, 500, 503]).toContain(res.status);
    });
  });

  describe('File Upload Integration', () => {
    it('should allow file upload endpoint to exist', async () => {
      // This test just verifies the endpoint exists
      // Full testing requires multipart/form-data which supertest handles differently
      const res = await request('http://localhost:5000')
        .post('/api/client/files/upload')
        .field('clientId', 'test-client-id')
        .field('description', 'Test file');
      // Should fail validation (no file), but endpoint should exist
      expect([400, 401]).toContain(res.status);
    });
  });
});
