const Queue = require('bull');
const { generateProspects } = require('../services/agentService');
const { importProspects } = require('../services/agentProspectService');

// Create a queue for agent-related background tasks
const agentQueue = new Queue('agent-tasks', process.env.REDIS_URL || 'redis://127.0.0.1:6379');

function initAgentWorker() {
  console.log('Agent Worker initialized');

  agentQueue.process('prospect', async (job) => {
    const { prompt, userId } = job.data;
    console.log(`Processing prospect job for user ${userId} with prompt: ${prompt}`);

    try {
      // 1. Call the AI service to generate leads
      const prospects = await generateProspects(prompt);

      if (!Array.isArray(prospects) || prospects.length === 0) {
        console.log('No prospects generated.');
        return;
      }

      // 2. Iterate and save to DB
      await importProspects({
        userId,
        auditActor: 'AI Agent Background Worker',
        prompt,
        prospects,
      });
      
      console.log(`Successfully imported ${prospects.length} AI prospects.`);
    } catch (error) {
      console.error('Failed to process agent prospect job:', error);
      throw error;
    }
  });
}

module.exports = {
  agentQueue,
  initAgentWorker
};
