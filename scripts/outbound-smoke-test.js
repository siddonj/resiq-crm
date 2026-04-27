#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const ROOT = process.cwd();
const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:5000';
const HEALTH_URL = `${BASE_URL}/api/health`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

async function waitForHealth(timeoutMs = 45000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const health = await fetchJson(HEALTH_URL);
      if (health.ok && health.data && health.data.status === 'ok') {
        return true;
      }
    } catch {
      // no-op: keep polling until timeout
    }

    await sleep(500);
  }

  return false;
}

async function waitForTables(databaseUrl, tables, timeoutMs = 45000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      const result = await client.query(
        `SELECT to_regclass($1) AS table_name`,
        [`public.${tables[0]}`]
      );

      let allReady = Boolean(result.rows[0]?.table_name);
      for (let i = 1; i < tables.length && allReady; i++) {
        const row = await client.query(`SELECT to_regclass($1) AS table_name`, [`public.${tables[i]}`]);
        allReady = Boolean(row.rows[0]?.table_name);
      }

      await client.end();
      if (allReady) return true;
    } catch {
      try { await client.end(); } catch {}
    }

    await sleep(500);
  }

  return false;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env not found at ${envPath}`);
  }

  return dotenv.parse(fs.readFileSync(envPath, 'utf8'));
}

function ensureEncryptionKey(envVars) {
  const key = envVars.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';
  assert(
    Buffer.from(key, 'utf8').length === 32,
    'ENCRYPTION_KEY must be exactly 32 bytes in .env before running smoke test'
  );
}

function buildCsvPayload() {
  return [
    'first_name,last_name,email,company,title,linkedin_url,location,notes',
    'Avery,Nguyen,avery.nguyen@example.com,Multifamily Tech Co,VP Operations,https://www.linkedin.com/in/avery-nguyen,Chicago,Interested in workflow automation',
    'Jordan,Lee,jordan.lee@example.com,PropStack Systems,Director of IT,https://www.linkedin.com/in/jordan-lee,Dallas,Exploring resident ops tooling',
  ].join('\n');
}

async function registerUser() {
  const email = `smoke_${Date.now()}@example.com`;
  const password = 'SmokeTest123!';

  const response = await fetchJson(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Outbound Smoke',
      email,
      password,
    }),
  });

  assert(response.ok, `register failed: ${JSON.stringify(response.data)}`);
  assert(response.data && response.data.token, 'register did not return token');
  assert(response.data && response.data.user && response.data.user.id, 'register did not return user id');

  return {
    token: response.data.token,
    userId: response.data.user.id,
  };
}

async function importCsv(token, csvText, sourceReference) {
  const form = new FormData();
  form.append('file', new Blob([csvText], { type: 'text/csv' }), 'outbound-smoke.csv');
  form.append('sourceType', 'csv');
  form.append('sourceReference', sourceReference);
  form.append('sourceConfidence', '85');

  const response = await fetchJson(`${BASE_URL}/api/outbound/leads/import/csv`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  assert(response.ok, `csv import failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function listLeads(token) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/leads?limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert(response.ok, `list leads failed: ${JSON.stringify(response.data)}`);
  assert(Array.isArray(response.data.leads), 'list leads response missing leads array');
  return response.data;
}

async function scoreLead(token, leadId) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/leads/${leadId}/score`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert(response.ok, `score lead failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function createCampaign(token, payload) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/campaigns`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  assert(response.ok, `create campaign failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function createSequence(token, payload) {
  const response = await fetchJson(`${BASE_URL}/api/sequences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  assert(response.ok, `create sequence failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function updateSequenceSteps(token, sequenceId, steps) {
  const response = await fetchJson(`${BASE_URL}/api/sequences/${sequenceId}/steps`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ steps }),
  });

  assert(response.ok, `update sequence steps failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function enrollLeadInSequence(token, sequenceId, leadId) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/sequences/${sequenceId}/enroll`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ leadId }),
  });

  assert(response.ok, `outbound sequence enroll failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function setSequenceEnrollmentState(token, enrollmentId, state, reason = null) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/sequences/enrollments/${enrollmentId}/state`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      state,
      reason,
    }),
  });

  assert(response.ok, `set enrollment state failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function listSequenceEnrollments(token, status = '') {
  const qs = status ? `?status=${encodeURIComponent(status)}&limit=200` : '?limit=200';
  const response = await fetchJson(`${BASE_URL}/api/outbound/sequences/enrollments${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  assert(response.ok, `list sequence enrollments failed: ${JSON.stringify(response.data)}`);
  assert(Array.isArray(response.data.enrollments), 'sequence enrollments response missing array');
  return response.data.enrollments;
}

async function createWorkflowRule(token, payload) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/workflows/rules`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  assert(response.ok, `create workflow rule failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function testWorkflowRule(token, ruleId, payload) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/workflows/rules/${ruleId}/test`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  assert(response.ok, `test workflow rule failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function listWorkflowRules(token) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/workflows/rules?includeDisabled=true`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  assert(response.ok, `list workflow rules failed: ${JSON.stringify(response.data)}`);
  assert(Array.isArray(response.data.rules), 'workflow rules response missing rules array');
  return response.data.rules;
}

async function listCampaigns(token) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/campaigns?limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert(response.ok, `list campaigns failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function updateCampaignStatus(token, campaignId, status) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/campaigns/${campaignId}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });

  assert(response.ok, `update campaign status failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function setSuppression(token, leadId, suppressed, reason = null) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/leads/${leadId}/suppression`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ suppressed, reason }),
  });

  assert(response.ok, `set suppression failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function generateDraft(token, leadId, channel) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/drafts/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ leadId, channel }),
  });

  assert(response.ok, `generate ${channel} draft failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function approveDraft(token, draftId) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/drafts/${draftId}/approve`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert(response.ok, `approve draft failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function sendEmailDraft(token, draftId) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/drafts/${draftId}/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  return response;
}

async function completeLinkedInTask(token, taskId) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/linkedin/tasks/${taskId}/complete`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ notes: 'Automated smoke test completion' }),
  });

  assert(response.ok, `complete linkedin task failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function analyticsSummary(token) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/analytics/summary`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  assert(response.ok, `analytics summary failed: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function exportCsv(token, path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    body: text,
  };
}

async function expectGenerateDraftConflict(token, leadId, channel) {
  const response = await fetchJson(`${BASE_URL}/api/outbound/drafts/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ leadId, channel }),
  });

  return response;
}

async function findLinkedInTaskId(databaseUrl, userId, draftId) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const query = await client.query(
      `SELECT id
       FROM linkedin_outreach_tasks
       WHERE user_id = $1
         AND draft_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, draftId]
    );

    assert(query.rows.length > 0, 'no linkedin_outreach_tasks row found for approved draft');
    return query.rows[0].id;
  } finally {
    await client.end();
  }
}

async function run() {
  const envVars = loadEnvFile();
  ensureEncryptionKey(envVars);
  const databaseUrl = envVars.DATABASE_URL || process.env.DATABASE_URL;
  assert(databaseUrl, 'DATABASE_URL missing from .env');

  let startedInProcess = false;
  const steps = [];

  const serverAlreadyUp = await waitForHealth(1500);
  if (!serverAlreadyUp) {
    require('../server/src/index.js');
    startedInProcess = true;
  }

  const isHealthy = await waitForHealth(60000);
  assert(isHealthy, `server did not become healthy at ${HEALTH_URL}`);
  const schemaReady = await waitForTables(
    databaseUrl,
    [
      'outbound_campaigns',
      'outbound_campaign_members',
      'outbound_sequence_enrollments',
      'outbound_sequence_enrollment_transitions',
      'workflow_rules',
      'workflow_rule_runs',
    ],
    60000
  );
  assert(schemaReady, 'required outbound campaign tables are not ready');
  steps.push({
    step: 'server_start',
    ok: true,
    mode: startedInProcess ? 'in_process' : 'already_running',
  });

  const auth = await registerUser();
  steps.push({
    step: 'auth_register',
    ok: true,
  });

  const csvText = buildCsvPayload();
  const firstImport = await importCsv(auth.token, csvText, 'smoke-import-1');
  const secondImport = await importCsv(auth.token, csvText, 'smoke-import-2');
  steps.push({
    step: 'csv_import_twice',
    ok: true,
    firstImport: {
      importedRows: firstImport.importedRows,
      duplicateRows: firstImport.duplicateRows,
      failedRows: firstImport.failedRows,
    },
    secondImport: {
      importedRows: secondImport.importedRows,
      duplicateRows: secondImport.duplicateRows,
      failedRows: secondImport.failedRows,
    },
  });

  assert(firstImport.importedRows === 2, `expected first import importedRows=2, got ${firstImport.importedRows}`);
  assert(firstImport.duplicateRows === 0, `expected first import duplicateRows=0, got ${firstImport.duplicateRows}`);
  assert(secondImport.importedRows === 0, `expected second import importedRows=0, got ${secondImport.importedRows}`);
  assert(secondImport.duplicateRows === 2, `expected second import duplicateRows=2, got ${secondImport.duplicateRows}`);

  const leads = await listLeads(auth.token);
  assert(leads.total === 2, `expected 2 leads after dedupe run, got ${leads.total}`);
  const leadIds = leads.leads.map((lead) => lead.id);
  const blockedLeadId = leadIds[1];

  const initialSuppression = await setSuppression(auth.token, blockedLeadId, true, 'Smoke suppression check');
  const blockedDraftAttempt = await expectGenerateDraftConflict(auth.token, blockedLeadId, 'email');
  assert(blockedDraftAttempt.status === 409, `expected suppressed draft generation to return 409, got ${blockedDraftAttempt.status}`);
  await setSuppression(auth.token, blockedLeadId, false, null);

  const sequence = await createSequence(auth.token, {
    name: `Smoke Sequence ${Date.now()}`,
    description: 'Phase 21 Slice 2 lifecycle validation',
  });
  await updateSequenceSteps(auth.token, sequence.id, [
    {
      delay_days: 0,
      type: 'email',
      subject: 'Quick intro',
      body: 'Hi {{first_name}}, this is a test sequence step.',
    },
    {
      delay_days: 1,
      type: 'email',
      subject: 'Follow up',
      body: 'Checking in after yesterday.',
    },
  ]);

  const enrolled = await enrollLeadInSequence(auth.token, sequence.id, blockedLeadId);
  assert(enrolled.status === 'active', `expected enrollment to be active, got ${enrolled.status}`);
  const paused = await setSequenceEnrollmentState(auth.token, enrolled.id, 'paused', 'Smoke pause');
  assert(paused.status === 'paused', `expected enrollment to pause, got ${paused.status}`);
  const resumed = await setSequenceEnrollmentState(auth.token, enrolled.id, 'active', 'Smoke resume');
  assert(resumed.status === 'active', `expected enrollment to resume, got ${resumed.status}`);

  const suppressionForAutoStop = await setSuppression(auth.token, blockedLeadId, true, 'Smoke auto-stop check');
  assert(
    Array.isArray(suppressionForAutoStop.autoStoppedEnrollmentIds) &&
      suppressionForAutoStop.autoStoppedEnrollmentIds.includes(enrolled.id),
    'expected suppression update to auto-stop the open enrollment'
  );

  const stoppedEnrollments = await listSequenceEnrollments(auth.token, 'stopped');
  const stoppedEnrollment = stoppedEnrollments.find((item) => item.id === enrolled.id);
  assert(stoppedEnrollment, 'expected enrolled lead to appear in stopped enrollments');
  await setSuppression(auth.token, blockedLeadId, false, null);

  const campaign = await createCampaign(auth.token, {
    name: `Smoke Campaign ${Date.now()}`,
    channels: ['email', 'linkedin'],
    audienceFilter: { minScore: 0, status: 'all' },
    leadIds,
  });
  assert(campaign.addedMembers === leadIds.length, `expected ${leadIds.length} members added, got ${campaign.addedMembers}`);
  const activeCampaign = await updateCampaignStatus(auth.token, campaign.id, 'active');
  assert(activeCampaign.status === 'active', 'campaign did not move to active');
  const campaignsList = await listCampaigns(auth.token);
  assert(Array.isArray(campaignsList.campaigns), 'campaigns list missing campaigns array');
  assert(campaignsList.campaigns.length >= 1, 'expected at least one campaign in list');

  const leadId = leads.leads[0].id;
  const scored = await scoreLead(auth.token, leadId);

  const workflowRule = await createWorkflowRule(auth.token, {
    name: `Smoke Rule ${Date.now()}`,
    triggerEvent: 'manual_test',
    conditions: {
      operator: 'AND',
      rules: [
        {
          field: 'lead.total_score',
          op: 'gte',
          value: 0,
        },
      ],
    },
    trueActions: [
      {
        type: 'set_next_recommended_action',
        config: { value: 'Workflow rule tested' },
      },
    ],
    falseActions: [],
    enabled: true,
    priority: 100,
  });

  const workflowRules = await listWorkflowRules(auth.token);
  assert(
    workflowRules.some((rule) => rule.id === workflowRule.id),
    'expected created workflow rule in workflow rules list'
  );

  const workflowDryRun = await testWorkflowRule(auth.token, workflowRule.id, {
    leadId,
    triggerEvent: 'manual_test',
    applyActions: false,
    eventData: { source: 'smoke_test' },
  });
  assert(
    workflowDryRun?.result?.status === 'success' || workflowDryRun?.result?.status === 'skipped',
    `unexpected workflow dry-run status: ${workflowDryRun?.result?.status}`
  );

  const workflowLiveRun = await testWorkflowRule(auth.token, workflowRule.id, {
    leadId,
    triggerEvent: 'manual_test',
    applyActions: true,
    eventData: { source: 'smoke_test' },
  });
  assert(
    workflowLiveRun?.result?.status === 'success' || workflowLiveRun?.result?.status === 'skipped',
    `unexpected workflow live-run status: ${workflowLiveRun?.result?.status}`
  );

  const leadsAfterRuleRun = await listLeads(auth.token);
  const updatedLeadAfterRule = leadsAfterRuleRun.leads.find((lead) => lead.id === leadId);
  assert(updatedLeadAfterRule, 'expected lead to exist after workflow live run');
  assert(
    updatedLeadAfterRule.next_recommended_action === 'Workflow rule tested',
    `expected workflow rule to update next_recommended_action, got ${updatedLeadAfterRule.next_recommended_action}`
  );

  const emailDraft = await generateDraft(auth.token, leadId, 'email');
  const linkedinDraft = await generateDraft(auth.token, leadId, 'linkedin');
  const sendBlockedBeforeApproval = await sendEmailDraft(auth.token, emailDraft.id);
  assert(
    sendBlockedBeforeApproval.status === 409,
    `expected email send to be blocked before approval, got ${sendBlockedBeforeApproval.status}`
  );
  const approvedEmail = await approveDraft(auth.token, emailDraft.id);
  assert(approvedEmail.status === 'approved', 'email draft approval failed');
  const sentEmail = await sendEmailDraft(auth.token, emailDraft.id);
  assert(sentEmail.ok, `sending approved email draft failed: ${JSON.stringify(sentEmail.data)}`);
  const approvedLinkedin = await approveDraft(auth.token, linkedinDraft.id);

  const taskId = await findLinkedInTaskId(databaseUrl, auth.userId, linkedinDraft.id);
  const completedTask = await completeLinkedInTask(auth.token, taskId);

  const analytics = await analyticsSummary(auth.token);
  const eventsExport = await exportCsv(auth.token, '/api/outbound/events/export?format=csv&days=30&limit=500');
  const auditExport = await exportCsv(auth.token, '/api/outbound/audit/export?format=csv&days=30&limit=500');
  assert(eventsExport.ok, `events export failed: ${eventsExport.status}`);
  assert(auditExport.ok, `audit export failed: ${auditExport.status}`);
  assert(eventsExport.contentType.includes('text/csv'), 'events export did not return csv');
  assert(auditExport.contentType.includes('text/csv'), 'audit export did not return csv');
  assert(eventsExport.body.includes('event_type'), 'events export missing expected header');
  assert(auditExport.body.includes('action'), 'audit export missing expected header');

  steps.push({
    step: 'workflow_rules',
    ok: true,
    ruleId: workflowRule.id,
    dryRunStatus: workflowDryRun?.result?.status,
    liveRunStatus: workflowLiveRun?.result?.status,
    nextRecommendedAction: updatedLeadAfterRule.next_recommended_action,
  });

  steps.push({
    step: 'outbound_flow',
    ok: true,
    leadId,
    score: scored.total_score,
    emailDraftId: emailDraft.id,
    approvedEmailDraftStatus: approvedEmail.status,
    sentEmailDraftStatus: sentEmail.data?.draft?.status,
    sendBlockedBeforeApprovalStatus: sendBlockedBeforeApproval.status,
    linkedinDraftId: linkedinDraft.id,
    approvedDraftStatus: approvedLinkedin.status,
    linkedinTaskId: completedTask.id,
    linkedinTaskStatus: completedTask.status,
  });

  steps.push({
    step: 'campaigns',
    ok: true,
    campaignId: campaign.id,
    campaignStatus: activeCampaign.status,
    campaignCount: campaignsList.campaigns.length,
  });

  steps.push({
    step: 'suppression',
    ok: true,
    blockedLeadId,
    initialSuppressionAutoStopped: Array.isArray(initialSuppression.autoStoppedEnrollmentIds)
      ? initialSuppression.autoStoppedEnrollmentIds.length
      : 0,
    blockedDraftStatus: blockedDraftAttempt.status,
  });

  steps.push({
    step: 'sequence_lifecycle',
    ok: true,
    sequenceId: sequence.id,
    enrollmentId: enrolled.id,
    pausedState: paused.status,
    resumedState: resumed.status,
    autoStopCount: suppressionForAutoStop.autoStoppedEnrollmentIds.length,
    stoppedState: stoppedEnrollment.status,
  });

  steps.push({
    step: 'analytics_summary',
    ok: true,
    totalLeads: analytics.leads ? analytics.leads.total_leads : null,
    pendingLinkedInTasks: analytics.pendingLinkedInTasks,
  });

  steps.push({
    step: 'exports',
    ok: true,
    eventsBytes: eventsExport.body.length,
    auditBytes: auditExport.body.length,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl: BASE_URL,
        steps,
      },
      null,
      2
    )
  );
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error.message,
        },
        null,
        2
      )
    );
    process.exit(1);
  });
