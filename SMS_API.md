# SMS API Documentation

## Overview

The SMS API enables sending, receiving, and managing SMS messages with contacts via Twilio. All SMS communications are TCPA-compliant with automatic opt-in/out handling.

**Base URL:** `/api/sms`
**Authentication:** Bearer token required (all endpoints)

---

## Endpoints

### SMS Sending

#### POST /sms/send
Send SMS to a single contact (template or custom).

**Request:**
```json
{
  "contactId": "550e8400-e29b-41d4-a716-446655440000",
  "templateId": "proposal_sent",
  "variables": {
    "firstName": "John",
    "dealName": "Q3 Proposal",
    "proposalLink": "https://portal.example.com/proposals/abc123",
    "expiryDate": "2026-05-19"
  }
}
```

**Alternative (Custom Message):**
```json
{
  "contactId": "550e8400-e29b-41d4-a716-446655440000",
  "content": "Hi John, check out your proposal!"
}
```

**Response:**
```json
{
  "success": true,
  "message": {
    "id": "msg-id-123",
    "status": "pending",
    "content": "Hi John, check out your proposal for Q3 Proposal...",
    "createdAt": "2026-04-19T12:00:00Z"
  }
}
```

**Status Codes:**
- `200` - SMS queued successfully
- `400` - Invalid request (missing fields, contact not found, etc.)
- `403` - Contact opted out of SMS
- `429` - Rate limit exceeded (10 SMS/hour per contact)
- `500` - Server error

---

#### POST /sms/send-batch
Send SMS to multiple contacts (bulk send).

**Request:**
```json
{
  "contactIds": [
    "550e8400-e29b-41d4-a716-446655440000",
    "550e8400-e29b-41d4-a716-446655440001"
  ],
  "templateId": "invoice_due",
  "variables": {
    "amount": "$1,500.00",
    "dueDate": "2026-05-01"
  }
}
```

**Response:**
```json
{
  "success": true,
  "results": {
    "sent": [
      { "contactId": "...", "messageId": "msg-123" }
    ],
    "failed": [
      { "contactId": "...", "error": "No phone number" }
    ],
    "skipped": [
      { "contactId": "...", "reason": "Opted out" }
    ]
  },
  "summary": {
    "sent": 1,
    "failed": 0,
    "skipped": 1,
    "total": 2
  }
}
```

---

### Message History

#### GET /contacts/:contactId/messages
Get SMS conversation history for a contact (paginated).

**Query Parameters:**
- `limit` (optional) - Records per page, max 100 (default 50)
- `offset` (optional) - Pagination offset (default 0)

**Response:**
```json
{
  "success": true,
  "messages": [
    {
      "id": "msg-123",
      "contactId": "contact-123",
      "direction": "outbound",
      "content": "Hi John, check out your proposal...",
      "status": "delivered",
      "phoneFrom": "+1-555-RESIQ-1",
      "phoneTo": "+14155552671",
      "deliveryTime": "2026-04-19T12:05:00Z",
      "createdAt": "2026-04-19T12:00:00Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 342,
    "pages": 7
  }
}
```

**Status Codes:**
- `200` - Success
- `404` - Contact not found
- `500` - Server error

---

#### GET /messages/:messageId
Get details of a single SMS message.

**Response:**
```json
{
  "success": true,
  "message": {
    "id": "msg-123",
    "contactId": "contact-123",
    "employeeId": "user-456",
    "direction": "inbound",
    "content": "Thanks for sending this!",
    "status": "delivered",
    "phoneFrom": "+14155552671",
    "phoneTo": "+1-555-RESIQ-1",
    "twilioMessageSid": "SM123456789",
    "errorMessage": null,
    "deliveryTime": "2026-04-19T12:05:00Z",
    "readAt": null,
    "createdAt": "2026-04-19T12:03:00Z"
  }
}
```

---

#### DELETE /messages/:messageId
Delete an SMS message.

**Response:**
```json
{
  "success": true,
  "message": "Message deleted"
}
```

---

### Templates

#### GET /templates
List all SMS templates (default + custom).

**Response:**
```json
{
  "success": true,
  "templates": [
    {
      "id": "tmpl-123",
      "name": "Proposal Sent",
      "slug": "proposal_sent",
      "content": "Hi {{firstName}}, check out our proposal for {{dealName}}: {{proposalLink}} (expires {{expiryDate}})",
      "description": "Sent when a proposal is shared with a client",
      "isDefault": true,
      "variables": ["firstName", "dealName", "proposalLink", "expiryDate"],
      "createdBy": null,
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ],
  "count": 5
}
```

---

#### POST /templates
Create a new custom SMS template.

**Request:**
```json
{
  "name": "Payment Reminder",
  "slug": "payment_reminder",
  "content": "Hi {{name}}, your invoice for {{amount}} is due on {{dueDate}}. Pay here: {{paymentLink}}",
  "description": "Reminder to pay outstanding invoices",
  "variables": ["name", "amount", "dueDate", "paymentLink"]
}
```

**Response:**
```json
{
  "success": true,
  "template": {
    "id": "tmpl-456",
    "name": "Payment Reminder",
    "slug": "payment_reminder",
    ...
  }
}
```

**Status Codes:**
- `201` - Created
- `400` - Invalid template syntax or duplicate slug
- `409` - Slug already exists

---

#### GET /templates/:templateId
Get a specific template by ID.

**Response:**
```json
{
  "success": true,
  "template": { ... }
}
```

---

#### PATCH /templates/:templateId
Update an existing template.

**Request:**
```json
{
  "content": "Updated content with {{variable}}",
  "description": "New description"
}
```

**Response:**
```json
{
  "success": true,
  "template": { ... }
}
```

---

#### DELETE /templates/:templateId
Delete a custom template (cannot delete default templates).

**Response:**
```json
{
  "success": true,
  "message": "Template deleted"
}
```

**Status Codes:**
- `200` - Deleted
- `403` - Cannot delete default template
- `404` - Template not found

---

### Opt-In / Opt-Out

#### POST /contacts/:contactId/sms-optout
Manually opt-out a contact from SMS.

**Response:**
```json
{
  "success": true,
  "optout": {
    "id": "optout-123",
    "contactId": "contact-123",
    "phoneNumber": "+14155552671",
    "reason": "manual",
    "optedOutAt": "2026-04-19T12:00:00Z",
    "optedOutBy": "user-456"
  }
}
```

---

#### POST /contacts/:contactId/sms-optin
Manually opt-in a contact to SMS (reverses opt-out).

**Response:**
```json
{
  "success": true,
  "message": "Contact opted in to SMS"
}
```

---

#### GET /optouts
List all opted-out contacts (paginated).

**Query Parameters:**
- `limit` (optional) - Records per page, max 500 (default 100)
- `offset` (optional) - Pagination offset (default 0)

**Response:**
```json
{
  "success": true,
  "optouts": [
    {
      "id": "optout-123",
      "contactId": "contact-123",
      "phoneNumber": "+14155552671",
      "reason": "stop_keyword",
      "optedOutAt": "2026-04-19T12:00:00Z",
      "optedOutBy": null,
      "name": "John Doe",
      "email": "john@example.com"
    }
  ],
  "pagination": {
    "limit": 100,
    "offset": 0,
    "total": 42,
    "pages": 1
  }
}
```

---

### Webhooks

#### POST /webhooks/twilio
Receive Twilio webhook events (inbound SMS, delivery status, opt-outs).

This endpoint receives callbacks from Twilio and must be publicly accessible.

**Twilio will send:**

**Inbound SMS:**
```
From=+14155552671&To=+1555RESIQ1&Body=Thanks+for+sending+this&MessageSid=SMxxxxx
```

**Delivery Status:**
```
MessageSid=SMxxxxx&MessageStatus=delivered
```

**Response:**
All webhook requests return HTTP 200 with TwiML:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>
```

---

#### GET /webhooks/health
Health check for webhook receiver.

**Response:**
```json
{
  "success": true,
  "health": {
    "twilioConfigured": true,
    "timestamp": "2026-04-19T12:00:00Z"
  }
}
```

---

## Message Status

- `pending` - Message created, queued for sending
- `sent` - Twilio accepted the message
- `delivered` - Contact received the message
- `failed` - Twilio could not deliver the message
- `read` - Contact read the message (if supported)

---

## Error Responses

**400 Bad Request:**
```json
{
  "error": "contactId is required"
}
```

**403 Forbidden:**
```json
{
  "error": "Contact has opted out of SMS"
}
```

**429 Too Many Requests:**
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 3600,
  "sentInLastHour": 10
}
```

**500 Server Error:**
```json
{
  "error": "Failed to send SMS"
}
```

---

## Rate Limiting

- **Per Contact:** 10 SMS/hour (configurable via `SMS_RATE_LIMIT_PER_HOUR`)
- **Batch Operations:** Limited by per-contact rate

---

## Template Variables

Common variables used across templates:

| Variable | Description | Example |
|----------|-------------|---------|
| `firstName` | Contact's first name | John |
| `lastName` | Contact's last name | Doe |
| `dealName` | Deal or project name | Q3 Proposal |
| `proposalLink` | Link to proposal portal | https://portal.example.com/proposals/abc |
| `invoiceNumber` | Invoice ID | INV-2026-001 |
| `amount` | Dollar amount | $1,500.00 |
| `dueDate` | Due date | 2026-05-01 |
| `paymentLink` | Link to payment portal | https://portal.example.com/pay/inv-123 |
| `meetingTitle` | Meeting name | Quarterly Review |
| `meetingTime` | Meeting time | 2:00 PM |
| `meetingDate` | Meeting date | April 25 |

---

## Authentication

All endpoints require an Authorization header with a valid JWT token:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Configuration

Required environment variables:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1-555-RESIQ-1
TWILIO_WEBHOOK_URL=https://yourdomain.com/api/webhooks/twilio
REDIS_URL=redis://localhost:6379
SMS_RATE_LIMIT_PER_HOUR=10
```

---

## Examples

### Example 1: Send Proposal SMS

```bash
curl -X POST http://localhost:5000/api/sms/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contactId": "550e8400-e29b-41d4-a716-446655440000",
    "templateId": "proposal_sent",
    "variables": {
      "firstName": "John",
      "dealName": "Website Redesign",
      "proposalLink": "https://portal.example.com/proposals/prop-123",
      "expiryDate": "2026-05-19"
    }
  }'
```

### Example 2: Send Batch Invoices

```bash
curl -X POST http://localhost:5000/api/sms/send-batch \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contactIds": ["contact-1", "contact-2", "contact-3"],
    "templateId": "invoice_due",
    "variables": {
      "amount": "$1,500.00",
      "dueDate": "2026-05-01"
    }
  }'
```

### Example 3: Get SMS History

```bash
curl -X GET 'http://localhost:5000/api/contacts/550e8400-e29b-41d4-a716-446655440000/messages?limit=20&offset=0' \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Compliance

- **TCPA Compliance:** Opt-in required before sending SMS
- **STOP Keyword:** Replies with "STOP" automatically opt-out contact
- **Privacy:** All messages encrypted in transit and at rest
- **Audit Trail:** All SMS logged as contact activities

---

## Support

For issues or questions, contact support@example.com
