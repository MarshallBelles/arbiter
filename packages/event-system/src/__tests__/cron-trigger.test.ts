import { CronTrigger } from '../triggers/cron-trigger';
import { EventTrigger, ArbiterEvent } from '@arbiter/core';

// Mock node-cron
jest.mock('node-cron', () => ({
  validate: jest.fn(),
  schedule: jest.fn(),
}));

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

const mockCron = require('node-cron');

describe('CronTrigger', () => {
  let cronTrigger: CronTrigger;
  let mockCallback: jest.Mock;
  let mockTask: any;

  beforeEach(() => {
    cronTrigger = new CronTrigger();
    mockCallback = jest.fn();
    mockTask = {
      start: jest.fn(),
      stop: jest.fn(),
    };
    
    // Reset mocks
    jest.clearAllMocks();
    mockCron.schedule.mockReturnValue(mockTask);
  });

  describe('constructor', () => {
    it('should create a new cron trigger instance', () => {
      expect(cronTrigger).toBeInstanceOf(CronTrigger);
    });

    it('should initialize with empty scheduled jobs', () => {
      const jobs = cronTrigger.getScheduledJobs();
      expect(jobs).toHaveLength(0);
    });
  });

  describe('register', () => {
    const createCronTrigger = (schedule: string = '0 0 * * *', timezone?: string): EventTrigger => ({
      type: 'cron',
      config: {
        cron: {
          schedule,
          timezone,
        },
      },
    });

    it('should register a valid cron job', async () => {
      const trigger = createCronTrigger();
      mockCron.validate.mockReturnValue(true);

      await cronTrigger.register(trigger, mockCallback);

      expect(mockCron.validate).toHaveBeenCalledWith('0 0 * * *');
      expect(mockCron.schedule).toHaveBeenCalled();
      expect(mockTask.start).toHaveBeenCalled();
    });

    it('should register cron job with timezone', async () => {
      const trigger = createCronTrigger('0 0 * * *', 'America/New_York');
      mockCron.validate.mockReturnValue(true);

      await cronTrigger.register(trigger, mockCallback);

      expect(mockCron.schedule).toHaveBeenCalledWith(
        '0 0 * * *',
        expect.any(Function),
        {
          scheduled: false,
          timezone: 'America/New_York',
        }
      );
    });

    it('should throw error for invalid trigger type', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {},
      };

      await expect(cronTrigger.register(trigger, mockCallback)).rejects.toThrow(
        'Invalid trigger type for cron trigger'
      );
    });

    it('should throw error for missing cron configuration', async () => {
      const trigger: EventTrigger = {
        type: 'cron',
        config: {},
      };

      await expect(cronTrigger.register(trigger, mockCallback)).rejects.toThrow(
        'Cron configuration is required'
      );
    });

    it('should throw error for invalid cron expression', async () => {
      const trigger = createCronTrigger('invalid-cron');
      mockCron.validate.mockReturnValue(false);

      await expect(cronTrigger.register(trigger, mockCallback)).rejects.toThrow(
        'Invalid cron expression: invalid-cron'
      );
    });

    it('should track registered jobs', async () => {
      const trigger = createCronTrigger();
      mockCron.validate.mockReturnValue(true);

      await cronTrigger.register(trigger, mockCallback);

      const jobs = cronTrigger.getScheduledJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatch(/^cron_\d+_[a-z0-9]+$/);
    });

    it('should execute callback when cron job triggers', async () => {
      const trigger = createCronTrigger();
      mockCron.validate.mockReturnValue(true);

      let cronFunction: Function;
      mockCron.schedule.mockImplementation((schedule, fn, options) => {
        cronFunction = fn;
        return mockTask;
      });

      await cronTrigger.register(trigger, mockCallback);

      // Simulate cron job execution
      await cronFunction();

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^cron_\d+_[a-z0-9]+$/),
          type: 'cron',
          source: 'cron:0 0 * * *',
          timestamp: expect.any(Date),
          data: {
            schedule: '0 0 * * *',
            timezone: 'UTC',
          },
          metadata: {
            jobId: expect.stringMatching(/^cron_\d+_[a-z0-9]+$/),
            schedule: '0 0 * * *',
            timezone: undefined,
          },
        })
      );
    });

    it('should handle callback errors gracefully', async () => {
      const trigger = createCronTrigger();
      mockCron.validate.mockReturnValue(true);
      mockCallback.mockRejectedValue(new Error('Callback error'));

      let cronFunction: Function;
      mockCron.schedule.mockImplementation((schedule, fn, options) => {
        cronFunction = fn;
        return mockTask;
      });

      await cronTrigger.register(trigger, mockCallback);

      // Simulate cron job execution with error
      await expect(cronFunction()).resolves.not.toThrow();
      expect(mockCallback).toHaveBeenCalled();
    });
  });

  describe('unregister', () => {
    it('should unregister cron jobs', async () => {
      const trigger: EventTrigger = {
        type: 'cron',
        config: {
          cron: {
            schedule: '0 0 * * *',
          },
        },
      };

      mockCron.validate.mockReturnValue(true);
      await cronTrigger.register(trigger, mockCallback);

      await cronTrigger.unregister(trigger);

      expect(mockTask.stop).toHaveBeenCalled();
      const jobs = cronTrigger.getScheduledJobs();
      expect(jobs).toHaveLength(0);
    });

    it('should handle missing cron configuration', async () => {
      const trigger: EventTrigger = {
        type: 'cron',
        config: {},
      };

      await expect(cronTrigger.unregister(trigger)).resolves.not.toThrow();
    });
  });

  describe('start', () => {
    it('should start the cron trigger', () => {
      expect(() => cronTrigger.start()).not.toThrow();
    });
  });

  describe('stop', () => {
    it('should stop all cron jobs', async () => {
      const trigger: EventTrigger = {
        type: 'cron',
        config: {
          cron: {
            schedule: '0 0 * * *',
          },
        },
      };

      mockCron.validate.mockReturnValue(true);
      await cronTrigger.register(trigger, mockCallback);

      cronTrigger.stop();

      expect(mockTask.stop).toHaveBeenCalled();
      const jobs = cronTrigger.getScheduledJobs();
      expect(jobs).toHaveLength(0);
    });

    it('should handle empty job list', () => {
      expect(() => cronTrigger.stop()).not.toThrow();
    });
  });

  describe('getScheduledJobs', () => {
    it('should return job IDs for registered jobs', async () => {
      const trigger1: EventTrigger = {
        type: 'cron',
        config: {
          cron: {
            schedule: '0 0 * * *',
          },
        },
      };

      const trigger2: EventTrigger = {
        type: 'cron',
        config: {
          cron: {
            schedule: '0 12 * * *',
          },
        },
      };

      mockCron.validate.mockReturnValue(true);
      await cronTrigger.register(trigger1, mockCallback);
      await cronTrigger.register(trigger2, mockCallback);

      const jobs = cronTrigger.getScheduledJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs.every(job => job.startsWith('cron_'))).toBe(true);
    });
  });

  describe('generateEventId', () => {
    it('should generate unique event IDs', () => {
      const trigger = cronTrigger as any;
      const id1 = trigger.generateEventId();
      const id2 = trigger.generateEventId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^cron_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^cron_\d+_[a-z0-9]+$/);
    });
  });

  describe('edge cases', () => {
    it('should handle multiple jobs with same schedule', async () => {
      const trigger: EventTrigger = {
        type: 'cron',
        config: {
          cron: {
            schedule: '0 0 * * *',
          },
        },
      };

      mockCron.validate.mockReturnValue(true);
      await cronTrigger.register(trigger, mockCallback);
      await cronTrigger.register(trigger, mockCallback);

      const jobs = cronTrigger.getScheduledJobs();
      expect(jobs).toHaveLength(2);
    });

    it('should handle complex cron expressions', async () => {
      const trigger: EventTrigger = {
        type: 'cron',
        config: {
          cron: {
            schedule: '*/15 9-17 * * 1-5',
            timezone: 'America/New_York',
          },
        },
      };

      mockCron.validate.mockReturnValue(true);
      await cronTrigger.register(trigger, mockCallback);

      expect(mockCron.validate).toHaveBeenCalledWith('*/15 9-17 * * 1-5');
      expect(mockCron.schedule).toHaveBeenCalledWith(
        '*/15 9-17 * * 1-5',
        expect.any(Function),
        {
          scheduled: false,
          timezone: 'America/New_York',
        }
      );
    });
  });
});