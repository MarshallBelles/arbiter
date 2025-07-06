import { ArbiterEvent, EventTrigger, createLogger } from '@arbiter/core';
import { EventEmitter } from 'events';

const logger = createLogger('WebhookTrigger');

export class WebhookTrigger extends EventEmitter {
  private registeredWebhooks = new Map<string, any>();

  async register(trigger: EventTrigger, callback: (event: ArbiterEvent) => Promise<any>): Promise<void> {
    if (trigger.type !== 'webhook') {
      throw new Error('Invalid trigger type for webhook trigger');
    }

    const config = trigger.config.webhook;
    if (!config) {
      throw new Error('Webhook configuration is required');
    }

    const webhookId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.registeredWebhooks.set(webhookId, {
      trigger,
      callback,
      endpoint: config.endpoint,
      method: config.method,
      headers: config.headers || {},
    });

    logger.info(`Registered webhook: ${config.endpoint}`, {
      webhookId,
      method: config.method,
    });
  }

  async unregister(trigger: EventTrigger): Promise<void> {
    const config = trigger.config.webhook;
    if (!config) {
      return;
    }

    // Find and remove webhook by endpoint
    for (const [webhookId, webhook] of this.registeredWebhooks) {
      if (webhook.endpoint === config.endpoint) {
        this.registeredWebhooks.delete(webhookId);
        logger.info(`Unregistered webhook: ${config.endpoint}`, { webhookId });
        break;
      }
    }
  }

  async handleWebhookRequest(endpoint: string, method: string, body: any, headers: any): Promise<any> {
    logger.info(`Received webhook request: ${method} ${endpoint}`);

    // Find matching webhook
    for (const [webhookId, webhook] of this.registeredWebhooks) {
      if (webhook.endpoint === endpoint && webhook.method.toLowerCase() === method.toLowerCase()) {
        
        // Validate headers if configured
        if (webhook.headers) {
          const valid = this.validateHeaders(headers, webhook.headers);
          if (!valid) {
            logger.warn(`Webhook header validation failed: ${endpoint}`, { webhookId });
            return { error: 'Invalid headers' };
          }
        }

        // Create event
        const event: ArbiterEvent = {
          id: this.generateEventId(),
          type: 'webhook',
          source: `webhook:${endpoint}`,
          timestamp: new Date(),
          data: body,
          metadata: {
            webhookId,
            endpoint,
            method,
            headers,
          },
        };

        try {
          const result = await webhook.callback(event);
          logger.info(`Webhook processed successfully: ${endpoint}`, { webhookId });
          return result;
        } catch (error) {
          logger.error(`Webhook processing failed: ${endpoint}`, {
            webhookId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return { error: 'Processing failed' };
        }
      }
    }

    logger.warn(`No webhook handler found: ${method} ${endpoint}`);
    return { error: 'Webhook not found' };
  }

  private validateHeaders(receivedHeaders: any, expectedHeaders: any): boolean {
    for (const [key, value] of Object.entries(expectedHeaders)) {
      if (receivedHeaders[key] !== value) {
        return false;
      }
    }
    return true;
  }

  private generateEventId(): string {
    return `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getRegisteredWebhooks(): { endpoint: string; method: string }[] {
    return Array.from(this.registeredWebhooks.values()).map(webhook => ({
      endpoint: webhook.endpoint,
      method: webhook.method,
    }));
  }

  start(): void {
    logger.info('Webhook trigger started');
  }

  stop(): void {
    this.registeredWebhooks.clear();
    logger.info('Webhook trigger stopped');
  }
}