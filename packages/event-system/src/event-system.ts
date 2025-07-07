import {
  ArbiterEvent,
  EventHandler,
  EventProcessingResult,
  WorkflowConfig,
  EventTrigger,
  createLogger,
  ArbiterError,
} from '@arbiter/core';
import { WebhookTrigger } from './triggers/webhook-trigger';
import { CronTrigger } from './triggers/cron-trigger';
import { FileWatchTrigger } from './triggers/file-watch-trigger';
import { ManualTrigger } from './triggers/manual-trigger';

const logger = createLogger('EventSystem');

export type EventTriggerHandler = (event: ArbiterEvent) => Promise<EventProcessingResult>;

export class EventSystem {
  private eventHandlers = new Map<string, EventHandler>();
  private triggerInstances = new Map<string, any>();
  private workflowConfigs = new Map<string, WorkflowConfig>();
  private eventTriggerHandler?: EventTriggerHandler;

  constructor() {
    this.initializeTriggers();
  }

  private initializeTriggers(): void {
    // Initialize trigger handlers
    this.triggerInstances.set('webhook', new WebhookTrigger());
    this.triggerInstances.set('cron', new CronTrigger());
    this.triggerInstances.set('file-watch', new FileWatchTrigger());
    this.triggerInstances.set('manual', new ManualTrigger());

    logger.info('Event system initialized', {
      triggerTypes: Array.from(this.triggerInstances.keys()),
    });
  }

  setEventTriggerHandler(handler: EventTriggerHandler): void {
    this.eventTriggerHandler = handler;
  }

  async registerWorkflow(workflow: WorkflowConfig): Promise<void> {
    try {
      this.workflowConfigs.set(workflow.id, workflow);

      // Create event handler for this workflow
      const eventHandler: EventHandler = {
        id: `handler_${workflow.id}`,
        eventType: workflow.trigger.type,
        workflowId: workflow.id,
        condition: workflow.trigger.config?.webhook?.endpoint || workflow.trigger.config?.cron?.schedule,
        enabled: true,
        triggerCount: 0,
      };

      this.eventHandlers.set(eventHandler.id, eventHandler);

      // Register with appropriate trigger
      const trigger = this.triggerInstances.get(workflow.trigger.type);
      if (trigger) {
        await trigger.register(workflow.trigger, (event: ArbiterEvent) => {
          return this.handleEvent(event, eventHandler);
        });
      }

      logger.info(`Registered workflow trigger: ${workflow.name}`, {
        workflowId: workflow.id,
        triggerType: workflow.trigger.type,
      });

    } catch (error) {
      logger.error(`Failed to register workflow: ${workflow.name}`, {
        workflowId: workflow.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async unregisterWorkflow(workflowId: string): Promise<void> {
    const workflow = this.workflowConfigs.get(workflowId);
    if (!workflow) {
      throw new ArbiterError(`Workflow not found: ${workflowId}`, 'WORKFLOW_NOT_FOUND');
    }

    try {
      // Find and remove event handler
      const handlerId = `handler_${workflowId}`;
      const handler = this.eventHandlers.get(handlerId);
      
      if (handler) {
        // Unregister from trigger
        const trigger = this.triggerInstances.get(workflow.trigger.type);
        if (trigger) {
          await trigger.unregister(workflow.trigger);
        }

        this.eventHandlers.delete(handlerId);
      }

      this.workflowConfigs.delete(workflowId);

      logger.info(`Unregistered workflow trigger: ${workflow.name}`, {
        workflowId: workflowId,
        triggerType: workflow.trigger.type,
      });

    } catch (error) {
      logger.error(`Failed to unregister workflow: ${workflowId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async triggerManualEvent(workflowId: string, data: any): Promise<EventProcessingResult> {
    const workflow = this.workflowConfigs.get(workflowId);
    if (!workflow) {
      throw new ArbiterError(`Workflow not found: ${workflowId}`, 'WORKFLOW_NOT_FOUND');
    }

    const event: ArbiterEvent = {
      id: this.generateEventId(),
      type: 'manual',
      source: 'arbiter-manual',
      timestamp: new Date(),
      data: data,
      metadata: {
        workflowId: workflowId,
        triggeredBy: 'manual',
      },
    };

    const handlerId = `handler_${workflowId}`;
    const handler = this.eventHandlers.get(handlerId);
    
    if (!handler) {
      throw new ArbiterError(`Event handler not found for workflow: ${workflowId}`, 'HANDLER_NOT_FOUND');
    }

    return await this.handleEvent(event, handler);
  }

  private async handleEvent(event: ArbiterEvent, handler: EventHandler): Promise<EventProcessingResult> {
    try {
      logger.info(`Processing event: ${event.type}`, {
        eventId: event.id,
        workflowId: handler.workflowId,
        handlerId: handler.id,
      });

      // Check if handler is enabled
      if (!handler.enabled) {
        logger.info(`Event handler disabled, skipping event: ${event.id}`, {
          handlerId: handler.id,
        });
        return {
          success: true,
          skipped: true,
          reason: 'Handler disabled',
        };
      }

      // Update trigger count
      handler.triggerCount++;
      handler.lastTriggered = new Date();

      // Call the configured event trigger handler
      if (!this.eventTriggerHandler) {
        throw new ArbiterError('No event trigger handler configured', 'NO_HANDLER');
      }

      const result = await this.eventTriggerHandler(event);

      logger.info(`Event processed successfully: ${event.id}`, {
        workflowExecutionId: result.workflowExecutionId,
        handlerId: handler.id,
      });

      return result;

    } catch (error) {
      logger.error(`Failed to process event: ${event.id}`, {
        handlerId: handler.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  getEventHandlers(): EventHandler[] {
    return Array.from(this.eventHandlers.values());
  }

  getEventHandler(handlerId: string): EventHandler | undefined {
    return this.eventHandlers.get(handlerId);
  }

  async enableEventHandler(handlerId: string): Promise<void> {
    const handler = this.eventHandlers.get(handlerId);
    if (!handler) {
      throw new ArbiterError(`Event handler not found: ${handlerId}`, 'HANDLER_NOT_FOUND');
    }

    handler.enabled = true;
    logger.info(`Enabled event handler: ${handlerId}`);
  }

  async disableEventHandler(handlerId: string): Promise<void> {
    const handler = this.eventHandlers.get(handlerId);
    if (!handler) {
      throw new ArbiterError(`Event handler not found: ${handlerId}`, 'HANDLER_NOT_FOUND');
    }

    handler.enabled = false;
    logger.info(`Disabled event handler: ${handlerId}`);
  }

  getWorkflowConfigs(): WorkflowConfig[] {
    return Array.from(this.workflowConfigs.values());
  }

  getWorkflowConfig(workflowId: string): WorkflowConfig | undefined {
    return this.workflowConfigs.get(workflowId);
  }

  async startEventSystem(): Promise<void> {
    logger.info('Starting event system');
    
    // Start all triggers
    for (const [triggerType, trigger] of this.triggerInstances) {
      try {
        if (trigger.start) {
          await trigger.start();
        }
        logger.info(`Started trigger: ${triggerType}`);
      } catch (error) {
        logger.error(`Failed to start trigger: ${triggerType}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('Event system started successfully');
  }

  async stopEventSystem(): Promise<void> {
    logger.info('Stopping event system');
    
    // Stop all triggers
    for (const [triggerType, trigger] of this.triggerInstances) {
      try {
        if (trigger.stop) {
          await trigger.stop();
        }
        logger.info(`Stopped trigger: ${triggerType}`);
      } catch (error) {
        logger.error(`Failed to stop trigger: ${triggerType}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('Event system stopped successfully');
  }

  async triggerManualEvent(workflowId: string, data: any): Promise<any> {
    const manualTrigger = this.triggerInstances.get('manual') as ManualTrigger;
    if (!manualTrigger) {
      throw new ArbiterError('Manual trigger not available', 'TRIGGER_NOT_FOUND');
    }

    return await manualTrigger.triggerManual(workflowId, data);
  }

  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  getTriggerTypes(): string[] {
    return Array.from(this.triggerInstances.keys());
  }

  getTriggerInstance(type: string): any {
    return this.triggerInstances.get(type);
  }

  getEventStats(): { totalHandlers: number; enabledHandlers: number; totalTriggers: number } {
    const handlers = Array.from(this.eventHandlers.values());
    const totalHandlers = handlers.length;
    const enabledHandlers = handlers.filter(h => h.enabled).length;
    const totalTriggers = handlers.reduce((sum, h) => sum + h.triggerCount, 0);

    return {
      totalHandlers,
      enabledHandlers,
      totalTriggers,
    };
  }
}