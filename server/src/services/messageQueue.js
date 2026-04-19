/**
 * Message Queue Service
 * Handles reliable SMS sending with retry logic using Bull queue and Redis
 */

const Queue = require('bull');
const Redis = require('ioredis');
const TwilioService = require('./twilioService');
const SMS = require('../models/SMS');

// Initialize Redis connection
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false
};

// Parse REDIS_URL if provided (for managed Redis services)
let redisUrl = process.env.REDIS_URL;
if (redisUrl && redisUrl.startsWith('redis://')) {
  // Bull can accept redis:// URLs directly
  redisConfig = redisUrl;
}

// Create message queue
const messageQueue = new Queue('sms-messages', redisConfig);

// Queue configuration
const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF = 5000; // 5 seconds, will increase exponentially
const JOB_TIMEOUT = 30000; // 30 seconds

class MessageQueueService {
  /**
   * Initialize queue event handlers
   */
  static initialize() {
    messageQueue.process('send', RETRY_ATTEMPTS, async (job) => {
      return this.processSendJob(job);
    });

    messageQueue.on('failed', (job, error) => {
      console.error(`❌ SMS job failed (${job.id}):`, error.message);
    });

    messageQueue.on('completed', (job) => {
      console.log(`✓ SMS job completed (${job.id})`);
    });

    messageQueue.on('stalled', (job) => {
      console.warn(`⚠️  SMS job stalled (${job.id})`);
    });

    console.log('✓ Message queue initialized');
  }

  /**
   * Enqueue SMS for sending
   * @param {Object} options - { messageId, to, content, retryCount }
   * @returns {Promise<Object>} Job info
   */
  static async enqueueSMS(options) {
    const { messageId, to, content } = options;

    if (!messageId || !to || !content) {
      throw new Error('Missing required fields: messageId, to, content');
    }

    try {
      const job = await messageQueue.add(
        'send',
        {
          messageId,
          to,
          content
        },
        {
          attempts: RETRY_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: RETRY_BACKOFF
          },
          removeOnComplete: true,
          removeOnFail: false,
          timeout: JOB_TIMEOUT,
          jobId: `sms-${messageId}` // Unique job ID per message
        }
      );

      console.log(`✓ SMS queued (Job ${job.id}, Message ${messageId})`);

      return {
        success: true,
        jobId: job.id,
        messageId,
        attempts: RETRY_ATTEMPTS
      };
    } catch (error) {
      console.error('❌ Error enqueueing SMS:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process send job from queue
   * @param {Object} job - Bull job
   * @returns {Promise<Object>} Job result
   */
  static async processSendJob(job) {
    const { messageId, to, content } = job.data;

    console.log(`Processing SMS job: ${job.id} (Message: ${messageId}, Attempt: ${job.attemptsMade + 1}/${RETRY_ATTEMPTS})`);

    // Update message status to 'sending'
    try {
      await SMS.updateStatus(messageId, 'sent');
    } catch (error) {
      console.error(`Cannot update message status: ${error.message}`);
    }

    // Send via Twilio
    const result = await TwilioService.sendSMS({
      to,
      content,
      messageId
    });

    if (!result.success) {
      console.error(`❌ Failed to send SMS (${messageId}): ${result.error}`);

      // If all retries exhausted, mark as failed
      if (job.attemptsMade >= RETRY_ATTEMPTS - 1) {
        try {
          await SMS.updateStatus(messageId, 'failed', result.error);
        } catch (error) {
          console.error(`Cannot mark message as failed: ${error.message}`);
        }
      }

      // Throw to trigger retry
      throw new Error(result.error);
    }

    console.log(`✓ SMS sent successfully (${messageId}), Twilio SID: ${result.twilio_message_sid}`);

    return {
      success: true,
      messageId,
      twilio_message_sid: result.twilio_message_sid,
      status: result.status
    };
  }

  /**
   * Get job status
   * @param {string} jobId - Bull job ID
   * @returns {Promise<Object>} Job status
   */
  static async getJobStatus(jobId) {
    try {
      const job = await messageQueue.getJob(jobId);

      if (!job) {
        return { found: false };
      }

      const state = await job.getState();
      const progress = job.progress();

      return {
        found: true,
        jobId: job.id,
        state,
        progress,
        attemptsMade: job.attemptsMade,
        data: job.data
      };
    } catch (error) {
      console.error('Error fetching job status:', error.message);
      return { found: false, error: error.message };
    }
  }

  /**
   * Retry a failed job
   * @param {string} jobId - Bull job ID
   * @returns {Promise<Object>} Job info
   */
  static async retryJob(jobId) {
    try {
      const job = await messageQueue.getJob(jobId);

      if (!job) {
        return { success: false, error: 'Job not found' };
      }

      await job.retry();

      return { success: true, jobId };
    } catch (error) {
      console.error('Error retrying job:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get queue statistics
   * @returns {Promise<Object>} Queue stats
   */
  static async getQueueStats() {
    try {
      const counts = await messageQueue.getJobCounts();
      const failed = await messageQueue.getFailed(0, 100);
      const delayed = await messageQueue.getDelayed(0, 100);

      return {
        active: counts.active,
        waiting: counts.waiting,
        completed: counts.completed,
        failed: counts.failed,
        delayed: counts.delayed,
        failedJobs: failed.map(job => ({
          id: job.id,
          data: job.data,
          attemptsMade: job.attemptsMade
        })),
        delayedJobs: delayed.map(job => ({
          id: job.id,
          data: job.data
        }))
      };
    } catch (error) {
      console.error('Error getting queue stats:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Clear failed jobs
   * @returns {Promise<number>} Number of jobs cleared
   */
  static async clearFailedJobs() {
    try {
      const failed = await messageQueue.getFailed(0, -1);
      let count = 0;

      for (const job of failed) {
        await job.remove();
        count++;
      }

      console.log(`✓ Cleared ${count} failed SMS jobs`);
      return count;
    } catch (error) {
      console.error('Error clearing failed jobs:', error.message);
      return 0;
    }
  }

  /**
   * Drain queue (wait for all jobs to complete)
   * @returns {Promise<void>}
   */
  static async drain() {
    try {
      await messageQueue.drain();
      console.log('✓ Queue drained');
    } catch (error) {
      console.error('Error draining queue:', error.message);
    }
  }

  /**
   * Close queue connection
   * @returns {Promise<void>}
   */
  static async close() {
    try {
      await messageQueue.close();
      console.log('✓ Message queue closed');
    } catch (error) {
      console.error('Error closing queue:', error.message);
    }
  }

  /**
   * Get Redis connection status
   * @returns {Promise<boolean>}
   */
  static async isRedisConnected() {
    try {
      const redis = new Redis(redisConfig);
      const result = await redis.ping();
      await redis.quit();
      return result === 'PONG';
    } catch (error) {
      console.error('Redis connection error:', error.message);
      return false;
    }
  }
}

module.exports = {
  MessageQueueService,
  messageQueue
};
