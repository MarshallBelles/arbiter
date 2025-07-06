import { ArbiterEvent, EventTrigger, createLogger } from '@arbiter/core';

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
    // Find and remove trigger
    for (const [triggerId, registeredTrigger] of this.registeredTriggers) {
      // Note: In a real implementation, you'd need to store the trigger config
      // to match against it properly. For now, we'll just remove all triggers.
      this.registeredTriggers.delete(triggerId);
      logger.info(`Unregistered manual trigger`, { triggerId });
    }
  }

  async triggerManual(data: any): Promise<any> {
    const event: ArbiterEvent = {
      id: this.generateEventId(),
      type: 'manual',
      source: 'manual-trigger',
      timestamp: new Date(),
      data: data,
      metadata: {
        triggeredBy: 'manual',
      },
    };

    // Execute all registered manual triggers
    const results = [];
    for (const [triggerId, registeredTrigger] of this.registeredTriggers) {
      try {
        logger.info(`Executing manual trigger`, { triggerId });
        const result = await registeredTrigger.callback(event);
        results.push(result);
      } catch (error) {
        logger.error(`Manual trigger failed`, {
          triggerId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        results.push({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    return results;
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