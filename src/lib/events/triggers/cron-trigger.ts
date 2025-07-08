import { ArbiterEvent, EventTrigger, createLogger } from '@/lib/core';
import * as cron from 'node-cron';

const logger = createLogger('CronTrigger');

export class CronTrigger {
  private scheduledJobs = new Map<string, cron.ScheduledTask>();
  private triggerConfigs = new Map<string, EventTrigger>();

  async register(trigger: EventTrigger, callback: (event: ArbiterEvent) => Promise<any>): Promise<void> {
    if (trigger.type !== 'cron') {
      throw new Error('Invalid trigger type for cron trigger');
    }

    const config = trigger.config.cron;
    if (!config) {
      throw new Error('Cron configuration is required');
    }

    // Validate cron expression
    if (!cron.validate(config.schedule)) {
      throw new Error(`Invalid cron expression: ${config.schedule}`);
    }

    const jobId = `cron_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const task = cron.schedule(config.schedule, async () => {
      logger.info(`Cron job triggered: ${config.schedule}`, { jobId });

      const event: ArbiterEvent = {
        id: this.generateEventId(),
        type: 'cron',
        source: `cron:${config.schedule}`,
        timestamp: new Date(),
        data: {
          schedule: config.schedule,
          timezone: config.timezone || 'UTC',
        },
        metadata: {
          jobId,
          schedule: config.schedule,
          timezone: config.timezone,
          workflowId: trigger.workflowId,
        },
      };

      try {
        await callback(event);
        logger.info(`Cron job completed: ${config.schedule}`, { jobId });
      } catch (error) {
        logger.error(`Cron job failed: ${config.schedule}`, {
          jobId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, {
      timezone: config.timezone || 'UTC',
    });

    this.scheduledJobs.set(jobId, task);
    this.triggerConfigs.set(jobId, trigger);
    task.start();

    logger.info(`Registered cron job: ${config.schedule}`, {
      jobId,
      timezone: config.timezone || 'UTC',
    });
  }

  async unregister(trigger: EventTrigger): Promise<void> {
    const config = trigger.config.cron;
    if (!config) {
      return;
    }

    // Find and remove job by matching trigger configuration
    for (const [jobId, storedTrigger] of this.triggerConfigs) {
      const storedConfig = storedTrigger.config.cron;
      if (storedConfig && 
          storedConfig.schedule === config.schedule &&
          storedTrigger.workflowId === trigger.workflowId) {
        
        const task = this.scheduledJobs.get(jobId);
        if (task) {
          task.stop();
          this.scheduledJobs.delete(jobId);
        }
        this.triggerConfigs.delete(jobId);
        
        logger.info(`Unregistered cron job: ${config.schedule}`, { 
          jobId,
          workflowId: trigger.workflowId 
        });
        return;
      }
    }
    
    logger.warn(`Cron job not found for unregistration: ${config.schedule}`, {
      workflowId: trigger.workflowId
    });
  }

  private generateEventId(): string {
    return `cron_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getScheduledJobs(): string[] {
    return Array.from(this.scheduledJobs.keys());
  }

  start(): void {
    logger.info('Cron trigger started');
  }

  stop(): void {
    for (const [_jobId, task] of this.scheduledJobs) {
      task.stop();
    }
    this.scheduledJobs.clear();
    logger.info('Cron trigger stopped');
  }
}