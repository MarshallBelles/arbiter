import { ManualTrigger } from '../triggers/manual-trigger';
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

describe('ManualTrigger', () => {
  let manualTrigger: ManualTrigger;
  let mockCallback: jest.Mock;

  beforeEach(() => {
    manualTrigger = new ManualTrigger();
    mockCallback = jest.fn();
    
    // Reset mocks
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a new manual trigger instance', () => {
      expect(manualTrigger).toBeInstanceOf(ManualTrigger);
    });

    it('should initialize with empty registered triggers', () => {
      const triggers = manualTrigger.getRegisteredTriggers();
      expect(triggers).toHaveLength(0);
    });
  });

  describe('register', () => {
    const createManualTrigger = (): EventTrigger => ({
      type: 'manual',
      config: {},
    });

    it('should register a manual trigger', async () => {
      const trigger = createManualTrigger();

      await manualTrigger.register(trigger, mockCallback);

      const triggers = manualTrigger.getRegisteredTriggers();
      expect(triggers).toHaveLength(1);
      expect(triggers[0]).toMatch(/^manual_\d+_[a-z0-9]+$/);
    });

    it('should throw error for invalid trigger type', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {},
      };

      await expect(manualTrigger.register(trigger, mockCallback)).rejects.toThrow(
        'Invalid trigger type for manual trigger'
      );
    });

    it('should register multiple manual triggers', async () => {
      const trigger1 = createManualTrigger();
      const trigger2 = createManualTrigger();
      const callback2 = jest.fn();

      await manualTrigger.register(trigger1, mockCallback);
      await manualTrigger.register(trigger2, callback2);

      const triggers = manualTrigger.getRegisteredTriggers();
      expect(triggers).toHaveLength(2);
      expect(triggers.every(t => t.startsWith('manual_'))).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should unregister manual triggers', async () => {
      const trigger = {
        type: 'manual' as const,
        config: {},
      };

      await manualTrigger.register(trigger, mockCallback);
      await manualTrigger.unregister(trigger);

      const triggers = manualTrigger.getRegisteredTriggers();
      expect(triggers).toHaveLength(0);
    });

    it('should handle empty trigger list', async () => {
      const trigger = {
        type: 'manual' as const,
        config: {},
      };

      await expect(manualTrigger.unregister(trigger)).resolves.not.toThrow();
    });
  });

  describe('triggerManual', () => {
    it('should execute all registered triggers', async () => {
      const trigger = {
        type: 'manual' as const,
        config: {},
      };

      mockCallback.mockResolvedValue({ success: true });

      await manualTrigger.register(trigger, mockCallback);

      const testData = { test: 'data' };
      const results = await manualTrigger.triggerManual(testData);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^manual_\d+_[a-z0-9]+$/),
          type: 'manual',
          source: 'manual-trigger',
          timestamp: expect.any(Date),
          data: testData,
          metadata: {
            triggeredBy: 'manual',
          },
        })
      );

      expect(results).toEqual([{ success: true }]);
    });

    it('should execute multiple registered triggers', async () => {
      const trigger1 = {
        type: 'manual' as const,
        config: {},
      };

      const trigger2 = {
        type: 'manual' as const,
        config: {},
      };

      const callback2 = jest.fn();

      mockCallback.mockResolvedValue({ result: 'callback1' });
      callback2.mockResolvedValue({ result: 'callback2' });

      await manualTrigger.register(trigger1, mockCallback);
      await manualTrigger.register(trigger2, callback2);

      const testData = { test: 'data' };
      const results = await manualTrigger.triggerManual(testData);

      expect(mockCallback).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
      expect(results).toEqual([
        { result: 'callback1' },
        { result: 'callback2' },
      ]);
    });

    it('should handle callback errors gracefully', async () => {
      const trigger = {
        type: 'manual' as const,
        config: {},
      };

      mockCallback.mockRejectedValue(new Error('Callback error'));

      await manualTrigger.register(trigger, mockCallback);

      const testData = { test: 'data' };
      const results = await manualTrigger.triggerManual(testData);

      expect(results).toEqual([{ error: 'Callback error' }]);
    });

    it('should handle mixed success and error callbacks', async () => {
      const trigger1 = {
        type: 'manual' as const,
        config: {},
      };

      const trigger2 = {
        type: 'manual' as const,
        config: {},
      };

      const callback2 = jest.fn();

      mockCallback.mockResolvedValue({ success: true });
      callback2.mockRejectedValue(new Error('Callback error'));

      await manualTrigger.register(trigger1, mockCallback);
      await manualTrigger.register(trigger2, callback2);

      const testData = { test: 'data' };
      const results = await manualTrigger.triggerManual(testData);

      expect(results).toEqual([
        { success: true },
        { error: 'Callback error' },
      ]);
    });

    it('should handle unknown errors', async () => {
      const trigger = {
        type: 'manual' as const,
        config: {},
      };

      mockCallback.mockRejectedValue('Non-error object');

      await manualTrigger.register(trigger, mockCallback);

      const testData = { test: 'data' };
      const results = await manualTrigger.triggerManual(testData);

      expect(results).toEqual([{ error: 'Unknown error' }]);
    });

    it('should return empty array when no triggers registered', async () => {
      const testData = { test: 'data' };
      const results = await manualTrigger.triggerManual(testData);

      expect(results).toEqual([]);
    });

    it('should handle complex data objects', async () => {
      const trigger = {
        type: 'manual' as const,
        config: {},
      };

      mockCallback.mockResolvedValue({ success: true });

      await manualTrigger.register(trigger, mockCallback);

      const complexData = {
        user: { id: 123, name: 'Test User' },
        payload: { action: 'create', items: [1, 2, 3] },
        metadata: { timestamp: new Date(), version: '1.0' },
      };

      const results = await manualTrigger.triggerManual(complexData);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: complexData,
        })
      );

      expect(results).toEqual([{ success: true }]);
    });
  });

  describe('start', () => {
    it('should start the manual trigger', () => {
      expect(() => manualTrigger.start()).not.toThrow();
    });
  });

  describe('stop', () => {
    it('should stop and clear all registered triggers', async () => {
      const trigger = {
        type: 'manual' as const,
        config: {},
      };

      await manualTrigger.register(trigger, mockCallback);
      
      manualTrigger.stop();

      const triggers = manualTrigger.getRegisteredTriggers();
      expect(triggers).toHaveLength(0);
    });

    it('should handle empty trigger list', () => {
      expect(() => manualTrigger.stop()).not.toThrow();
    });
  });

  describe('getRegisteredTriggers', () => {
    it('should return trigger IDs for registered triggers', async () => {
      const trigger1 = {
        type: 'manual' as const,
        config: {},
      };

      const trigger2 = {
        type: 'manual' as const,
        config: {},
      };

      await manualTrigger.register(trigger1, mockCallback);
      await manualTrigger.register(trigger2, mockCallback);

      const triggers = manualTrigger.getRegisteredTriggers();
      expect(triggers).toHaveLength(2);
      expect(triggers.every(t => t.startsWith('manual_'))).toBe(true);
    });
  });

  describe('generateEventId', () => {
    it('should generate unique event IDs', () => {
      const trigger = manualTrigger as any;
      const id1 = trigger.generateEventId();
      const id2 = trigger.generateEventId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^manual_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^manual_\d+_[a-z0-9]+$/);
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid trigger registrations', async () => {
      const triggers = Array.from({ length: 10 }, () => ({
        type: 'manual' as const,
        config: {},
      }));

      const callbacks = Array.from({ length: 10 }, () => jest.fn().mockResolvedValue({ success: true }));

      // Register all triggers
      for (let i = 0; i < triggers.length; i++) {
        await manualTrigger.register(triggers[i], callbacks[i]);
      }

      const registeredTriggers = manualTrigger.getRegisteredTriggers();
      expect(registeredTriggers).toHaveLength(10);

      // Execute manual trigger
      const results = await manualTrigger.triggerManual({ test: 'data' });
      expect(results).toHaveLength(10);
      expect(results.every((r: any) => r.success === true)).toBe(true);

      // Verify all callbacks were called
      callbacks.forEach(callback => {
        expect(callback).toHaveBeenCalled();
      });
    });

    it('should handle register/unregister cycles', async () => {
      const trigger = {
        type: 'manual' as const,
        config: {},
      };

      // Register
      await manualTrigger.register(trigger, mockCallback);
      expect(manualTrigger.getRegisteredTriggers()).toHaveLength(1);

      // Unregister
      await manualTrigger.unregister(trigger);
      expect(manualTrigger.getRegisteredTriggers()).toHaveLength(0);

      // Register again
      await manualTrigger.register(trigger, mockCallback);
      expect(manualTrigger.getRegisteredTriggers()).toHaveLength(1);
    });
  });
});