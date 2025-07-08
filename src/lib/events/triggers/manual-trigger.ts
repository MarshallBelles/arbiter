import { ArbiterEvent, EventTrigger, createLogger } from '@/lib/core';

const logger = createLogger('ManualTrigger');

export class ManualTrigger {
  private registeredTriggers = new Map<string, any>();

  async register(trigger: EventTrigger, callback: (event: ArbiterEvent) => Promise<any>): Promise<void> {
    if (trigger.type !== 'manual') {
      throw new Error('Invalid trigger type for manual trigger');
    }

    const triggerId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.registeredTriggers.set(triggerId, {
      trigger,
      callback,
    });

    logger.info(`Registered manual trigger`, { triggerId });
  }

  async unregister(trigger: EventTrigger): Promise<void> {
    // Find and remove trigger by matching workflow ID
    for (const [triggerId, registeredData] of this.registeredTriggers) {
      if (registeredData.trigger.workflowId === trigger.workflowId) {
        this.registeredTriggers.delete(triggerId);
        logger.info(`Unregistered manual trigger`, { 
          triggerId,
          workflowId: trigger.workflowId 
        });
        return;
      }
    }
    
    logger.warn(`Manual trigger not found for unregistration`, {
      workflowId: trigger.workflowId
    });
  }

  async triggerManual(workflowId: string, data: any): Promise<any> {
    // Find the trigger for this workflow
    let targetTrigger = null;
    let targetTriggerId = null;
    
    for (const [triggerId, registeredData] of this.registeredTriggers) {
      if (registeredData.trigger.workflowId === workflowId) {
        targetTrigger = registeredData;
        targetTriggerId = triggerId;
        break;
      }
    }
    
    if (!targetTrigger) {
      throw new Error(`No manual trigger found for workflow: ${workflowId}`);
    }

    const event: ArbiterEvent = {
      id: this.generateEventId(),
      type: 'manual',
      source: 'manual-trigger',
      timestamp: new Date(),
      data: data,
      metadata: {
        triggeredBy: 'manual',
        workflowId: workflowId,
      },
    };

    try {
      logger.info(`Executing manual trigger for workflow`, { 
        triggerId: targetTriggerId,
        workflowId 
      });
      const result = await targetTrigger.callback(event);
      return result;
    } catch (error) {
      logger.error(`Manual trigger failed`, {
        triggerId: targetTriggerId,
        workflowId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private generateEventId(): string {
    return `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getRegisteredTriggers(): string[] {
    return Array.from(this.registeredTriggers.keys());
  }

  start(): void {
    logger.info('Manual trigger started');
  }

  stop(): void {
    this.registeredTriggers.clear();
    logger.info('Manual trigger stopped');
  }
}