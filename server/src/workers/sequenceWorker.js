const Queue = require('bull');
const pool = require('../models/db');
const gmailService = require('../services/gmail');
const twilioService = require('../services/twilioService');
const trackingService = require('../services/trackingService');

const sequenceQueue = new Queue('sequence-processor', process.env.REDIS_URL || 'redis://localhost:6379');

function initSequenceWorker() {
  // Process sequence steps
  sequenceQueue.process('process-due-steps', async (job) => {
    try {
      // 1. Find all active sequence enrollments due
      const { rows: enrollments } = await pool.query(
        `SELECT e.id, e.sequence_id, e.contact_id, e.user_id, e.current_step, e.next_step_due_at,
                c.email as contact_email, c.phone as contact_phone, c.name,
                u.email as user_email
         FROM sequence_enrollments e
         JOIN contacts c ON e.contact_id = c.id
         JOIN users u ON e.user_id = u.id
         WHERE e.status = 'active'
           AND e.next_step_due_at <= NOW()`
      );

      if (enrollments.length > 0) {
        console.log(`[Sequences] Found ${enrollments.length} due sequences to process`);
      }

      for (const enrollment of enrollments) {
        try {
          // 2. Get the current step details
          const { rows: steps } = await pool.query(
            `SELECT * FROM sequence_steps 
             WHERE sequence_id = $1 AND step_number = $2`,
             [enrollment.sequence_id, enrollment.current_step]
          );

          if (steps.length === 0) {
            // No more steps, sequence is completed
            await pool.query(
              `UPDATE sequence_enrollments SET status = 'completed', updated_at = NOW() WHERE id = $1`,
              [enrollment.id]
            );
            continue;
          }

          const step = steps[0];

          // 3. Execute step (Email or SMS)

          // Replace tags like {{first_name}} in body/subject
          const replaceTags = (text) => {
            if (!text) return '';
            const firstName = enrollment.name ? enrollment.name.split(' ')[0] : '';
            const lastName = enrollment.name && enrollment.name.split(' ').length > 1 
              ? enrollment.name.split(' ').slice(1).join(' ') 
              : '';
            return text.replace(/\{\{first_name\}\}/g, firstName).replace(/\{\{last_name\}\}/g, lastName);
          };

          const body = replaceTags(step.body);

          let success = false;
          
          if (step.type === 'email') {
            const subject = replaceTags(step.subject);
            const emailBody = trackingService.injectTrackingIntoHtml(
              replaceTags(step.body),
              enrollment.user_id,
              enrollment.contact_id,
              subject
            );

            if (!enrollment.contact_email) {
              throw new Error('Contact has no email');
            }
            
            try {
               await gmailService.sendEmail(
                 enrollment.user_id,
                 enrollment.contact_email,
                 subject,
                 emailBody
               );
               console.log(`[Sequence] Email dispatched. To: ${enrollment.contact_email} | Subject: ${subject}`);
               success = true;
            } catch (e) {
               console.error(`Failed to send sequence email to ${enrollment.contact_email}:`, e);
            }
          } 
          else if (step.type === 'sms') {
            if (!enrollment.contact_phone) {
               throw new Error('Contact has no phone number');
            }
            
            if (!twilioService.isConfigured()) {
              console.log(`[Sequence] Twilio not configured. Mocking SMS to ${enrollment.contact_phone} | Body: ${body}`);
              success = true; // Still mark true so the sequence doesn't halt indefinitely in dev
            } else {
               const result = await twilioService.sendSMS({
                 to: enrollment.contact_phone,
                 content: body,
                 messageId: `seq-${enrollment.id}-${step.id}`
               });
               
               if (result.success) {
                 success = true;
               } else {
                 console.error(`Failed to send sequence SMS to ${enrollment.contact_phone}:`, result.error);
               }
            }
          }

          // 4. Update the enrollment to point to the next step
          if (success) {
             const nextStepNumber = enrollment.current_step + 1;
             const { rows: nextSteps } = await pool.query(
               `SELECT delay_days FROM sequence_steps WHERE sequence_id = $1 AND step_number = $2`,
               [enrollment.sequence_id, nextStepNumber]
             );

             if (nextSteps.length > 0) {
               const delayDays = nextSteps[0].delay_days || 0;
               // Calculate next date. Wait x days from today
               await pool.query(
                 `UPDATE sequence_enrollments 
                  SET current_step = $1, next_step_due_at = NOW() + INTERVAL '${delayDays} days', updated_at = NOW() 
                  WHERE id = $2`,
                 [nextStepNumber, enrollment.id]
               );
               console.log(`[Sequence] Advanced sequence ${enrollment.id} to step ${nextStepNumber}, due in ${delayDays} days`);
             } else {
               // Sequence fully completed
               await pool.query(
                 `UPDATE sequence_enrollments SET status = 'completed', updated_at = NOW() WHERE id = $1`,
                 [enrollment.id]
               );
               console.log(`[Sequence] Enrollment ${enrollment.id} completed.`);
             }
          } else {
             await pool.query(
               `UPDATE sequence_enrollments SET status = 'error', updated_at = NOW() WHERE id = $1`,
               [enrollment.id]
             );
          }

        } catch (err) {
          console.error(`Error processing sequence enrollment ${enrollment.id}:`, err);
          await pool.query(
            `UPDATE sequence_enrollments SET status = 'error', updated_at = NOW() WHERE id = $1`,
            [enrollment.id]
          );
        }
      }
      
      return { processed: enrollments.length };
    } catch (globalErr) {
      console.error('Sequence processor global error:', globalErr);
    }
  });

  // Setup a repeatable job to run every minute
  sequenceQueue.add('process-due-steps', {}, { repeat: { cron: '* * * * *' } });

  console.log('✅ Sequence queue initialized');
}

module.exports = { sequenceQueue, initSequenceWorker };