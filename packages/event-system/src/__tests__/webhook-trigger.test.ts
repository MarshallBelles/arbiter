import { WebhookTrigger } from '../triggers/webhook-trigger';
import { EventTrigger, ArbiterEvent } from '@arbiter/core';

// Mock logger
jest.mock('@arbiter/core', () => ({
  ...jest.requireActual('@arbiter/core'),
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('WebhookTrigger', () => {
  let webhookTrigger: WebhookTrigger;

  beforeEach(() => {
    webhookTrigger = new WebhookTrigger();
  });

  describe('register', () => {
    const createWebhookTrigger = (): EventTrigger => ({
      type: 'webhook',
      config: {
        webhook: {
          endpoint: '/api/webhook/test',
          method: 'POST',
        },
      },
    });

    it('should register a webhook successfully', async () => {
      const trigger = createWebhookTrigger();
      const callback = jest.fn();

      await webhookTrigger.register(trigger, callback);

      const webhooks = webhookTrigger.getRegisteredWebhooks();
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].endpoint).toBe('/api/webhook/test');
      expect(webhooks[0].method).toBe('POST');
    });

    it('should register webhook with headers', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/secure',
            method: 'POST',
            headers: {
              'Authorization': 'Bearer token123',
              'Content-Type': 'application/json',
            },
          },
        },
      };
      const callback = jest.fn();

      await webhookTrigger.register(trigger, callback);

      const webhooks = webhookTrigger.getRegisteredWebhooks();
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].endpoint).toBe('/api/webhook/secure');
    });

    it('should throw error for invalid trigger type', async () => {
      const trigger: EventTrigger = {
        type: 'cron', // Invalid type
        config: {},
      };
      const callback = jest.fn();

      await expect(webhookTrigger.register(trigger, callback)).rejects.toThrow(
        'Invalid trigger type for webhook trigger'
      );
    });

    it('should throw error for missing webhook config', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {}, // Missing webhook config
      };
      const callback = jest.fn();

      await expect(webhookTrigger.register(trigger, callback)).rejects.toThrow(
        'Webhook configuration is required'
      );
    });

    it('should allow multiple webhooks with different endpoints', async () => {
      const trigger1 = createWebhookTrigger();
      const trigger2: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/different',
            method: 'GET',
          },
        },
      };

      await webhookTrigger.register(trigger1, jest.fn());
      await webhookTrigger.register(trigger2, jest.fn());

      const webhooks = webhookTrigger.getRegisteredWebhooks();
      expect(webhooks).toHaveLength(2);
    });
  });

  describe('unregister', () => {
    it('should unregister a webhook by endpoint', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/removeme',
            method: 'POST',
          },
        },
      };

      await webhookTrigger.register(trigger, jest.fn());
      expect(webhookTrigger.getRegisteredWebhooks()).toHaveLength(1);

      await webhookTrigger.unregister(trigger);
      expect(webhookTrigger.getRegisteredWebhooks()).toHaveLength(0);
    });

    it('should handle unregistering non-existent webhook', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/nonexistent',
            method: 'POST',
          },
        },
      };

      // Should not throw
      await expect(webhookTrigger.unregister(trigger)).resolves.not.toThrow();
    });

    it('should handle unregistering with missing config', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {},
      };

      // Should not throw
      await expect(webhookTrigger.unregister(trigger)).resolves.not.toThrow();
    });
  });

  describe('handleWebhookRequest', () => {
    beforeEach(async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/test',
            method: 'POST',
          },
        },
      };

      const callback = jest.fn().mockResolvedValue({
        success: true,
        workflowExecutionId: 'exec-123',
      });

      await webhookTrigger.register(trigger, callback);
    });

    it('should handle matching webhook request', async () => {
      const endpoint = '/api/webhook/test';
      const method = 'POST';
      const body = { test: 'data' };
      const headers = { 'content-type': 'application/json' };

      const result = await webhookTrigger.handleWebhookRequest(endpoint, method, body, headers);

      expect(result.success).toBe(true);
      expect(result.workflowExecutionId).toBe('exec-123');
    });

    it('should create proper event structure', async () => {
      const endpoint = '/api/webhook/test';
      const method = 'POST';
      const body = { input: 'test input', timestamp: '2023-01-01T00:00:00Z' };
      const headers = { 'user-agent': 'test-client' };

      const callback = jest.fn().mockResolvedValue({ success: true });
      
      // Register new webhook to capture the callback
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/capture',
            method: 'POST',
          },
        },
      };
      
      await webhookTrigger.register(trigger, callback);
      
      await webhookTrigger.handleWebhookRequest('/api/webhook/capture', method, body, headers);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'webhook',
          source: 'webhook:/api/webhook/capture',
          data: body,
          metadata: expect.objectContaining({
            endpoint: '/api/webhook/capture',
            method: 'POST',
            headers,
          }),
        })
      );
    });

    it('should handle case insensitive method matching', async () => {
      const result = await webhookTrigger.handleWebhookRequest(
        '/api/webhook/test',
        'post', // lowercase
        { test: 'data' },
        {}
      );

      expect(result.success).toBe(true);
    });

    it('should return error for non-matching endpoint', async () => {
      const result = await webhookTrigger.handleWebhookRequest(
        '/api/webhook/nonexistent',
        'POST',
        {},
        {}
      );

      expect(result.error).toBe('Webhook not found');
    });

    it('should return error for non-matching method', async () => {
      const result = await webhookTrigger.handleWebhookRequest(
        '/api/webhook/test',
        'GET', // Wrong method
        {},
        {}
      );

      expect(result.error).toBe('Webhook not found');
    });

    it('should handle callback errors', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/error',
            method: 'POST',
          },
        },
      };

      const callback = jest.fn().mockRejectedValue(new Error('Callback failed'));
      await webhookTrigger.register(trigger, callback);

      const result = await webhookTrigger.handleWebhookRequest(
        '/api/webhook/error',
        'POST',
        {},
        {}
      );

      expect(result.error).toBe('Processing failed');
    });
  });

  describe('header validation', () => {
    it('should validate required headers', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/secure',
            method: 'POST',
            headers: {
              'Authorization': 'Bearer secret123',
              'X-API-Key': 'api-key-456',
            },
          },
        },
      };

      const callback = jest.fn().mockResolvedValue({ success: true });
      await webhookTrigger.register(trigger, callback);

      // Valid headers
      const validResult = await webhookTrigger.handleWebhookRequest(
        '/api/webhook/secure',
        'POST',
        {},
        {
          'Authorization': 'Bearer secret123',
          'X-API-Key': 'api-key-456',
        }
      );

      expect(validResult.success).toBe(true);

      // Invalid headers
      const invalidResult = await webhookTrigger.handleWebhookRequest(
        '/api/webhook/secure',
        'POST',
        {},
        {
          'Authorization': 'Bearer wrong-token',
          'X-API-Key': 'api-key-456',
        }
      );

      expect(invalidResult.error).toBe('Invalid headers');
    });

    it('should handle missing headers as invalid', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/headers',
            method: 'POST',
            headers: {
              'Required-Header': 'required-value',
            },
          },
        },
      };

      const callback = jest.fn().mockResolvedValue({ success: true });
      await webhookTrigger.register(trigger, callback);

      const result = await webhookTrigger.handleWebhookRequest(
        '/api/webhook/headers',
        'POST',
        {},
        {} // Empty headers
      );

      expect(result.error).toBe('Invalid headers');
    });
  });

  describe('lifecycle methods', () => {
    it('should start webhook trigger', () => {
      expect(() => webhookTrigger.start()).not.toThrow();
    });

    it('should stop webhook trigger and clear webhooks', () => {
      // Register a webhook first
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/test',
            method: 'POST',
          },
        },
      };

      webhookTrigger.register(trigger, jest.fn());
      expect(webhookTrigger.getRegisteredWebhooks()).toHaveLength(1);

      webhookTrigger.stop();
      expect(webhookTrigger.getRegisteredWebhooks()).toHaveLength(0);
    });
  });

  describe('generateEventId', () => {
    it('should generate unique event IDs', () => {
      const trigger = webhookTrigger as any;
      
      const id1 = trigger.generateEventId();
      const id2 = trigger.generateEventId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^webhook_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^webhook_\d+_[a-z0-9]+$/);
    });
  });

  describe('edge cases', () => {
    it('should handle webhook with empty body', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/empty',
            method: 'POST',
          },
        },
      };

      const callback = jest.fn().mockResolvedValue({ success: true });
      await webhookTrigger.register(trigger, callback);

      const result = await webhookTrigger.handleWebhookRequest(
        '/api/webhook/empty',
        'POST',
        null, // Empty body
        {}
      );

      expect(result.success).toBe(true);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: null,
        })
      );
    });

    it('should handle webhook with complex nested data', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/complex',
            method: 'POST',
          },
        },
      };

      const callback = jest.fn().mockResolvedValue({ success: true });
      await webhookTrigger.register(trigger, callback);

      const complexData = {
        user: {
          id: 123,
          profile: {
            name: 'John Doe',
            preferences: ['dark-mode', 'notifications'],
          },
        },
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'api',
        },
      };

      const result = await webhookTrigger.handleWebhookRequest(
        '/api/webhook/complex',
        'POST',
        complexData,
        {}
      );

      expect(result.success).toBe(true);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: complexData,
        })
      );
    });
  });
});