# Client Portal - API Documentation

## Overview

The Client Portal is a separate, client-facing system that allows customers to:
- Sign up via email invitation
- View and sign proposals
- View and pay invoices
- Download shared files
- Track activity history

## Architecture

### Database Tables
- `clients` - Client accounts (separate from employee users)
- `client_invitations` - One-time invitation tokens
- `client_deal_access` - Which deals each client can access
- `client_shared_items` - Proposals, invoices, files shared with clients
- `client_activities` - Audit trail of client actions
- `client_files` - Shared documents/resources
- `client_file_shares` - Which files are shared with which clients

### Authentication

Two authentication flows:

**Flow 1: Passwordless (Magic Link)**
1. Employee invites client via `/api/auth/client/invite`
2. Email is sent with magic link token
3. Client clicks link, enters name
4. Client receives JWT token for subsequent requests

**Flow 2: Password Login**
1. Client can set password during signup
2. Client logs in with `/api/auth/client/login` (email + password)
3. Receives JWT token

Both methods use JWT tokens that expire in 30 days.

## API Endpoints

### Client Authentication

#### POST /api/auth/client/invite
**Employee endpoint** - Invite a new client
```json
{
  "email": "client@example.com",
  "name": "Client Name",
  "dealId": "optional-deal-uuid"
}
```
Returns: Invitation details and sends email with magic link

#### POST /api/auth/client/verify/:token
**Client signup** - Verify invitation and create account
```json
{
  "name": "Client Name",
  "password": "optional-password"
}
```
Returns: JWT token

#### POST /api/auth/client/login
**Client login** - Login with password
```json
{
  "email": "client@example.com",
  "password": "password"
}
```
Returns: JWT token

#### POST /api/auth/client/password
**Authenticated client** - Set/update password
```json
{
  "password": "new-password",
  "currentPassword": "only-if-updating"
}
```

### Client Portal (Authenticated)

#### GET /api/client/me
Get authenticated client's profile
```json
{
  "id": "uuid",
  "name": "Client Name",
  "email": "client@example.com",
  "slug": "client-name-xyz",
  "phone": "optional",
  "firstLoginAt": "2026-04-19...",
  "lastLoginAt": "2026-04-19...",
  "createdAt": "2026-04-19..."
}
```

#### GET /api/client/proposals
List all proposals shared with client
```json
[
  {
    "id": "uuid",
    "title": "Proposal Title",
    "status": "draft|sent|viewed|signed|declined",
    "sections": [],
    "line_items": [],
    "sent_at": "2026-04-19...",
    "viewed_at": "2026-04-19...",
    "signed_at": "2026-04-19...",
    "signature_name": "Client Name"
  }
]
```

#### GET /api/client/proposals/:proposalId
Get proposal details (marks as viewed)
Returns: Single proposal object

#### PATCH /api/client/proposals/:proposalId/sign
Sign a proposal
```json
{
  "signatureName": "Client Name"
}
```
Returns: Updated proposal with signed_at timestamp

#### GET /api/client/invoices
List all invoices shared with client
```json
[
  {
    "id": "uuid",
    "invoice_number": "INV-1001",
    "title": "Invoice Title",
    "status": "draft|sent|paid|overdue",
    "line_items": [],
    "due_date": "2026-05-19",
    "sent_at": "2026-04-19...",
    "paid_at": null,
    "stripe_payment_url": "https://..."
  }
]
```

#### GET /api/client/invoices/:invoiceId
Get invoice details
Returns: Single invoice object

#### POST /api/client/invoices/:invoiceId/pay
Initiate invoice payment (returns Stripe link)
```json
{
  "paymentUrl": "https://checkout.stripe.com/..."
}
```

#### GET /api/client/files
List shared files
```json
[
  {
    "id": "uuid",
    "file_name": "document.pdf",
    "file_size": 1024000,
    "mime_type": "application/pdf",
    "shared_at": "2026-04-19..."
  }
]
```

#### GET /api/client/files/:fileId/download
Download a file
Returns: File metadata and path for download

#### GET /api/client/activity
Get activity log (last 50 actions)
```json
[
  {
    "id": "uuid",
    "action": "viewed_proposal|signed_proposal|viewed_invoice|paid_invoice|downloaded_file|logged_in",
    "metadata": {},
    "created_at": "2026-04-19..."
  }
]
```

### Client Management (Employee, Authenticated)

#### POST /api/clients
Invite a new client
```json
{
  "email": "client@example.com",
  "name": "Client Name",
  "dealId": "optional-deal-uuid"
}
```

#### GET /api/clients
List all clients
Returns: Array of client objects

#### GET /api/clients/:clientId
Get client details with stats
```json
{
  "id": "uuid",
  "name": "Client Name",
  "email": "client@example.com",
  "slug": "client-name-xyz",
  "is_active": true,
  "first_login_at": "2026-04-19...",
  "last_login_at": "2026-04-19...",
  "accessibleDeals": [...],
  "sharedItems": {
    "proposal": 2,
    "invoice": 1,
    "file": 3
  }
}
```

#### PATCH /api/clients/:clientId
Update client profile
```json
{
  "name": "Updated Name",
  "phone": "+1234567890"
}
```

#### POST /api/clients/:clientId/grant-access
Grant client access to a deal
```json
{
  "dealId": "deal-uuid"
}
```

#### DELETE /api/clients/:clientId/revoke-access/:dealId
Revoke client access to a deal

#### POST /api/clients/:clientId/share-item
Share proposal, invoice, or file with client
```json
{
  "itemType": "proposal|invoice|file",
  "itemId": "item-uuid"
}
```

#### GET /api/clients/:clientId/activity
Get activity log for a client (100 most recent)
Returns: Array of activity objects

#### DELETE /api/clients/:clientId
Deactivate a client

## Implementation Status

### ✅ Completed
- Database schema (Phase 14a)
- Client model with auth methods
- Client auth routes (signup, login, password)
- Client auth middleware
- Client portal routes (proposals, invoices, files, activity)
- Client management routes (admin/employee endpoints)

### ⏳ TODO (Phase 14b-e)
- [ ] Client portal UI (React components)
- [ ] Email notifications for proposals/invoices
- [ ] File upload and sharing infrastructure
- [ ] Stripe payment integration with client portal
- [ ] E-signature integration
- [ ] Activity tracking enhancements
- [ ] Testing (unit, integration, e2e)

## Security Considerations

✅ **Implemented:**
- Passwordless magic link tokens (48-hour expiry)
- JWT tokens for authenticated requests (30-day expiry)
- SQL injection prevention (parameterized queries)
- Client isolation (clients only see their own proposals, invoices, files)
- Audit logging of all client actions
- Password hashing with bcrypt

⚠️ **To Consider for Production:**
- Rate limiting on auth endpoints
- HTTPS only
- CORS configuration for client portal domain
- IP-based access controls (optional)
- Multi-factor authentication (future)
- Session management (prevent concurrent logins)

## Testing Endpoints

### Invite a client
```bash
curl -X POST http://localhost:5000/api/auth/client/invite \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_EMPLOYEE_JWT" \
  -d '{
    "email": "client@example.com",
    "name": "John Doe"
  }'
```

### Client signup (replace TOKEN)
```bash
curl -X POST http://localhost:5000/api/auth/client/verify/TOKEN \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "password": "secure-password"
  }'
```

### View proposals
```bash
curl -X GET http://localhost:5000/api/client/proposals \
  -H "Authorization: Bearer YOUR_CLIENT_JWT"
```

### Sign proposal
```bash
curl -X PATCH http://localhost:5000/api/client/proposals/PROPOSAL_ID/sign \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CLIENT_JWT" \
  -d '{
    "signatureName": "John Doe"
  }'
```

## Next Steps

1. **Build Client Portal UI** (React)
   - Login page with email verification
   - Password setup (optional)
   - Dashboard showing proposals/invoices/files
   - Proposal viewer with e-signature widget
   - Invoice viewer with Stripe payment button
   - File browser with download

2. **Email Notifications**
   - Client invited
   - Proposal sent / Reminder to sign
   - Invoice sent / Reminder to pay
   - Proposal signed notification to employee
   - Invoice paid notification to employee

3. **Integrations**
   - Stripe for invoice payments
   - DocuSign/similar for e-signature
   - S3/cloud storage for files

4. **Testing**
   - Unit tests for auth flows
   - Integration tests for permissions
   - E2E: invite → sign → pay workflow
