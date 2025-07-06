import { 
  validateAgentConfig, 
  validateWorkflowConfig, 
  validateEventTrigger,
  validateJSON 
} from '../utils/validation';
import { AgentConfig, WorkflowConfig, EventTrigger } from '../types/index';

describe('validation utilities', () => {
  describe('validateAgentConfig', () => {
    it('should pass validation for valid agent config', () => {
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'A test agent',
        model: 'granite',
        systemPrompt: 'You are a test agent',
        availableTools: ['tool1', 'tool2'],
        level: 0,
      };

      const errors = validateAgentConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation for missing required fields', () => {
      const config = {} as AgentConfig;
      const errors = validateAgentConfig(config);
      
      expect(errors).toContain('Agent ID is required and must be a string');
      expect(errors).toContain('Agent name is required and must be a string');
      expect(errors).toContain('Agent model is required and must be a string');
      expect(errors).toContain('Agent system prompt is required and must be a string');
      expect(errors).toContain('Agent level must be a non-negative number');
      expect(errors).toContain('Available tools must be an array');
    });

    it('should fail validation for invalid data types', () => {
      const config = {
        id: 123,
        name: null,
        model: '',
        systemPrompt: {},
        availableTools: 'not-an-array',
        level: -1,
      } as any;

      const errors = validateAgentConfig(config);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for negative level', () => {
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'A test agent',
        model: 'granite',
        systemPrompt: 'You are a test agent',
        availableTools: [],
        level: -1,
      };

      const errors = validateAgentConfig(config);
      expect(errors).toContain('Agent level must be a non-negative number');
    });
  });

  describe('validateEventTrigger', () => {
    it('should pass validation for valid webhook trigger', () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook',
            method: 'POST',
          },
        },
      };

      const errors = validateEventTrigger(trigger);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation for valid cron trigger', () => {
      const trigger: EventTrigger = {
        type: 'cron',
        config: {
          cron: {
            schedule: '0 0 * * *',
            timezone: 'UTC',
          },
        },
      };

      const errors = validateEventTrigger(trigger);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation for invalid trigger type', () => {
      const trigger = {
        type: 'invalid-type',
        config: {},
      } as any;

      const errors = validateEventTrigger(trigger);
      expect(errors).toContain('Trigger type must be one of: webhook, cron, manual, file-watch, api');
    });

    it('should fail validation for missing config', () => {
      const trigger = {
        type: 'webhook',
      } as any;

      const errors = validateEventTrigger(trigger);
      expect(errors).toContain('Trigger config is required and must be an object');
    });
  });

  describe('validateWorkflowConfig', () => {
    const validAgentConfig: AgentConfig = {
      id: 'root-agent',
      name: 'Root Agent',
      description: 'Root agent for workflow',
      model: 'granite',
      systemPrompt: 'You are the root agent',
      availableTools: [],
      level: 0,
    };

    const validTrigger: EventTrigger = {
      type: 'manual',
      config: {},
    };

    it('should pass validation for valid workflow config', () => {
      const config: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0.0',
        trigger: validTrigger,
        rootAgent: validAgentConfig,
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const errors = validateWorkflowConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation for missing required fields', () => {
      const config = {} as WorkflowConfig;
      const errors = validateWorkflowConfig(config);
      
      expect(errors).toContain('Workflow ID is required and must be a string');
      expect(errors).toContain('Workflow name is required and must be a string');
      expect(errors).toContain('Root agent is required');
      expect(errors).toContain('Workflow trigger is required');
      expect(errors).toContain('Workflow levels must be an array');
    });

    it('should include agent validation errors', () => {
      const config: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0.0',
        trigger: validTrigger,
        rootAgent: {} as AgentConfig,
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const errors = validateWorkflowConfig(config);
      expect(errors.some(error => error.includes('Agent'))).toBe(true);
    });
  });

  describe('validateJSON', () => {
    it('should validate correct JSON', () => {
      const jsonString = '{"test": "value", "number": 123}';
      const result = validateJSON(jsonString);
      
      expect(result.valid).toBe(true);
      expect(result.parsed).toEqual({ test: 'value', number: 123 });
      expect(result.error).toBeUndefined();
    });

    it('should handle invalid JSON', () => {
      const jsonString = '{"test": invalid}';
      const result = validateJSON(jsonString);
      
      expect(result.valid).toBe(false);
      expect(result.parsed).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it('should handle empty string', () => {
      const result = validateJSON('');
      expect(result.valid).toBe(false);
    });

    it('should handle complex valid JSON', () => {
      const complexObject = {
        reasoning: 'Test reasoning',
        tool_calls: [
          {
            tool_name: 'test_tool',
            parameters: { param1: 'value1' },
            purpose: 'testing',
            sequence_order: 1,
          },
        ],
        status: 'working',
      };
      
      const jsonString = JSON.stringify(complexObject);
      const result = validateJSON(jsonString);
      
      expect(result.valid).toBe(true);
      expect(result.parsed).toEqual(complexObject);
    });
  });
});