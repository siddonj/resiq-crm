const Queue = require('bull');
const pool = require('../models/db');
const emailMatcher = require('../services/emailMatcher');

// Create Bull queue for email syncing
const emailSyncQueue = new Queue('email-sync', process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Process email sync job for a user
 * Max 2 concurrent jobs with exponential backoff retry
 */
emailSyncQueue.process(2, async (job) => {
  const { userId, pageToken = null, labelIds = null } = job.data;

  try {
    const labelText = labelIds && labelIds.length > 0
      ? `, labels: [${labelIds.join(', ')}]`
      : '';
    console.log(`Starting email sync for user ${userId}, page: ${pageToken || 'first'}${labelText}`);

    // Check if user still has Gmail connected
    const userResult = await pool.query(
      'SELECT id, oauth_provider FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult.rows[0]) {
      throw new Error('User not found');
    }

    if (userResult.rows[0].oauth_provider !== 'gmail') {
      console.log(`User ${userId} not connected to Gmail, skipping`);
      return { skipped: true, reason: 'Not connected to Gmail' };
    }

    // Sync emails from Gmail
    const result = await emailMatcher.syncUserEmails(userId, {
      maxResults: 20,
      pageToken,
      labelIds,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to sync emails');
    }

    console.log(`Synced ${result.count} emails for user ${userId}`);

    // If there's a next page, queue another job to continue pagination
    if (result.nextPageToken) {
      await emailSyncQueue.add(
        { userId, pageToken: result.nextPageToken },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
        }
      );
      console.log(`Queued next page for user ${userId}`);
    }

    return result;
  } catch (err) {
    console.error(`Email sync failed for user ${userId}:`, err);
    throw err; // Bull will handle retry with backoff
  }
});

/**
 * Event handlers
 */
emailSyncQueue.on('completed', (job) => {
  console.log(`✅ Email sync completed for job ${job.id}`);
});

emailSyncQueue.on('failed', (job, err) => {
  console.error(`❌ Email sync failed for job ${job.id}: ${err.message}`);
});

emailSyncQueue.on('error', (err) => {
  console.error('Email sync queue error:', err);
});

/**
 * Schedule recurring sync jobs for all connected users
 * Run every 5 minutes
 */
async function scheduleRecurringSyncs() {
  try {
    // Get all users with Gmail connected
    const result = await pool.query(
      'SELECT id FROM users WHERE oauth_provider = $1 ORDER BY RANDOM()',
      ['gmail']
    );

    const users = result.rows;
    console.log(`Scheduling email sync for ${users.length} connected users`);

    for (const user of users) {
      // Check if job already exists for this user
      const existingJobs = await emailSyncQueue.getRepeatableJobs();
      const hasJob = existingJobs.some(
        (j) => j.key.includes(`${user.id}`) && j.every === 5 * 60 * 1000
      );

      if (!hasJob) {
        // Add repeating job: every 5 minutes
        await emailSyncQueue.add(
          { userId: user.id },
          {
            repeat: { every: 5 * 60 * 1000 }, // 5 minutes
            removeOnComplete: true,
          }
        );
        console.log(`Scheduled recurring sync for user ${user.id}`);
      }
    }
  } catch (err) {
    console.error('Error scheduling recurring syncs:', err);
  }
}

/**
 * Initialize queue and schedule syncs
 */
async function initEmailSyncWorker() {
  try {
    // Wait for queue to be ready
    await emailSyncQueue.isReady();
    console.log('Email sync queue ready');

    // Schedule recurring syncs
    await scheduleRecurringSyncs();

    // Re-schedule every hour in case new users connected
    setInterval(scheduleRecurringSyncs, 60 * 60 * 1000);
  } catch (err) {
    console.error('Failed to initialize email sync worker:', err);
  }
}

/**
 * Clean up queue on shutdown
 */
process.on('SIGTERM', async () => {
  console.log('Closing email sync queue...');
  await emailSyncQueue.close();
});

module.exports = {
  emailSyncQueue,
  initEmailSyncWorker,
};
