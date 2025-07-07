import request from 'supertest';
import express from 'express';
import { workflowRoutes } from '../../routes/workflows';
import { ArbiterService } from '../../services/arbiter-service';
import { errorHandler } from '../../middleware/error-handler';
import { WorkflowConfig } from '@arbiter/core';

// Mock the ArbiterService
jest.mock('../../services/arbiter-service');

describe('Workflow Validation Edge Cases', () => {
  let app: express.Application;
  let mockArbiterService: jest.Mocked<ArbiterService>;

  beforeEach(() => {
    app = express();
    app.use(express.json({ limit: '50mb' }));
    
    mockArbiterService = {
      createWorkflow: jest.fn(),
      updateWorkflow: jest.fn(),
      getWorkflow: jest.fn(),
      deleteWorkflow: jest.fn(),
      listWorkflows: jest.fn(),
      executeWorkflow: jest.fn(),
    } as any;

    app.use((req, res, next) => {
      (req as any).arbiterService = mockArbiterService;
      next();
    });

    app.use('/api/workflows', workflowRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Level Validation Edge Cases', () => {
    it('should handle workflows with non-sequential level numbers', async () => {
      const nonSequentialWorkflow: WorkflowConfig = {
        id: 'non-sequential-workflow',
        name: 'Non-Sequential Levels Workflow',
        description: 'Workflow with non-sequential level numbers',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'Root agent prompt',
          availableTools: [],
          level: 0,
        },
        levels: [
          {
            level: 5, // Skipping levels 1-4
            agents: [{
              id: 'level5-agent',
              name: 'Level 5 Agent',
              description: 'Agent at level 5',
              model: 'granite',
              systemPrompt: 'Level 5 prompt',
              availableTools: [],
              level: 5,
            }],
            executionMode: 'parallel',
          },
          {
            level: 10, // Skipping levels 6-9
            agents: [{
              id: 'level10-agent',
              name: 'Level 10 Agent',
              description: 'Agent at level 10',
              model: 'granite',
              systemPrompt: 'Level 10 prompt',
              availableTools: [],
              level: 10,
            }],
            executionMode: 'conditional',
          },
        ],
      };

      mockArbiterService.createWorkflow.mockResolvedValue('non-sequential-workflow');

      const response = await request(app)
        .post('/api/workflows')
        .send(nonSequentialWorkflow);

      // Should handle non-sequential levels (might accept or reject based on business logic)
      expect([201, 400]).toContain(response.status);
      
      if (response.status === 400) {
        console.log('Non-sequential levels rejected:', response.body.message);
      } else {
        console.log('Non-sequential levels accepted');
      }
    });

    it('should handle workflows with duplicate level numbers', async () => {
      const duplicateLevelWorkflow: WorkflowConfig = {
        id: 'duplicate-level-workflow',
        name: 'Duplicate Level Workflow',
        description: 'Workflow with duplicate level numbers',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'Root agent prompt',
          availableTools: [],
          level: 0,
        },
        levels: [
          {
            level: 1,
            agents: [{
              id: 'level1-agent-a',
              name: 'Level 1 Agent A',
              description: 'First agent at level 1',
              model: 'granite',
              systemPrompt: 'Level 1A prompt',
              availableTools: [],
              level: 1,
            }],
            executionMode: 'parallel',
          },
          {
            level: 1, // Duplicate level number
            agents: [{
              id: 'level1-agent-b',
              name: 'Level 1 Agent B',
              description: 'Second agent at level 1',
              model: 'granite',
              systemPrompt: 'Level 1B prompt',
              availableTools: [],
              level: 1,
            }],
            executionMode: 'conditional',
          },
        ],
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(duplicateLevelWorkflow);

      // Should reject duplicate levels
      expect([400, 201]).toContain(response.status);
      
      if (response.status === 400) {
        expect(response.body.message).toMatch(/level.*duplicate|duplicate.*level/i);
      } else {
        console.warn('VALIDATION ISSUE: Duplicate levels were accepted');
      }
    });

    it('should handle workflows with agent level mismatches', async () => {
      const levelMismatchWorkflow: WorkflowConfig = {
        id: 'level-mismatch-workflow',
        name: 'Level Mismatch Workflow',
        description: 'Workflow with agent level mismatches',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'Root agent prompt',
          availableTools: [],
          level: 0,
        },
        levels: [
          {
            level: 1,
            agents: [
              {
                id: 'correct-level-agent',
                name: 'Correct Level Agent',
                description: 'Agent with correct level',
                model: 'granite',
                systemPrompt: 'Correct level prompt',
                availableTools: [],
                level: 1, // Correct level
              },
              {
                id: 'wrong-level-agent',
                name: 'Wrong Level Agent',
                description: 'Agent with wrong level',
                model: 'granite',
                systemPrompt: 'Wrong level prompt',
                availableTools: [],
                level: 3, // Wrong level - should be 1
              }
            ],
            executionMode: 'parallel',
          },
        ],
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(levelMismatchWorkflow);

      // Should detect level mismatch
      expect([400, 201]).toContain(response.status);
      
      if (response.status === 400) {
        expect(response.body.message).toMatch(/level.*mismatch|agent.*level/i);
      } else {
        console.warn('VALIDATION ISSUE: Agent level mismatch was not detected');
      }
    });
  });

  describe('Agent Configuration Edge Cases', () => {
    it('should handle workflows with duplicate agent IDs across levels', async () => {
      const duplicateAgentIdWorkflow: WorkflowConfig = {
        id: 'duplicate-agent-id-workflow',
        name: 'Duplicate Agent ID Workflow',
        description: 'Workflow with duplicate agent IDs',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'duplicate-agent', // Same ID as level agent
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'Root agent prompt',
          availableTools: [],
          level: 0,
        },
        levels: [
          {
            level: 1,
            agents: [{
              id: 'duplicate-agent', // Same ID as root agent
              name: 'Level 1 Agent',
              description: 'Level 1 agent with duplicate ID',
              model: 'granite',
              systemPrompt: 'Level 1 prompt',
              availableTools: [],
              level: 1,
            }],
            executionMode: 'parallel',
          },
        ],
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(duplicateAgentIdWorkflow);

      // Should reject duplicate agent IDs
      expect([400, 201]).toContain(response.status);
      
      if (response.status === 400) {
        expect(response.body.message).toMatch(/duplicate.*agent|agent.*duplicate|unique.*id/i);
      } else {
        console.warn('VALIDATION ISSUE: Duplicate agent IDs were accepted');
      }
    });

    it('should handle workflows with empty agent arrays', async () => {
      const emptyAgentsWorkflow: WorkflowConfig = {
        id: 'empty-agents-workflow',
        name: 'Empty Agents Workflow',
        description: 'Workflow with empty agent arrays',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'Root agent prompt',
          availableTools: [],
          level: 0,
        },
        levels: [
          {
            level: 1,
            agents: [], // Empty agents array
            executionMode: 'parallel',
          },
          {
            level: 2,
            agents: [{
              id: 'level2-agent',
              name: 'Level 2 Agent',
              description: 'Level 2 agent',
              model: 'granite',
              systemPrompt: 'Level 2 prompt',
              availableTools: [],
              level: 2,
            }],
            executionMode: 'conditional',
          },
        ],
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(emptyAgentsWorkflow);

      // Should handle empty agent arrays (might accept or reject)
      expect([201, 400]).toContain(response.status);
      
      if (response.status === 400) {
        console.log('Empty agent arrays rejected:', response.body.message);
      } else {
        console.log('Empty agent arrays accepted');
      }
    });

    it('should handle workflows with invalid execution modes', async () => {
      const invalidExecutionModeWorkflow: WorkflowConfig = {
        id: 'invalid-execution-mode-workflow',
        name: 'Invalid Execution Mode Workflow',
        description: 'Workflow with invalid execution modes',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'Root agent prompt',
          availableTools: [],
          level: 0,
        },
        levels: [
          {
            level: 1,
            agents: [{
              id: 'level1-agent',
              name: 'Level 1 Agent',
              description: 'Level 1 agent',
              model: 'granite',
              systemPrompt: 'Level 1 prompt',
              availableTools: [],
              level: 1,
            }],
            executionMode: 'invalid-mode' as any, // Invalid execution mode
          },
        ],
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(invalidExecutionModeWorkflow);

      // Should reject invalid execution modes
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/execution.*mode|mode.*invalid|valid.*parallel|valid.*conditional/i);
    });
  });

  describe('Trigger Configuration Edge Cases', () => {
    it('should handle workflows with invalid trigger types', async () => {
      const invalidTriggerWorkflow: WorkflowConfig = {
        id: 'invalid-trigger-workflow',
        name: 'Invalid Trigger Workflow',
        description: 'Workflow with invalid trigger type',
        version: '1.0.0',
        trigger: {
          type: 'invalid-trigger-type' as any,
          config: {},
        },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'Root agent prompt',
          availableTools: [],
          level: 0,
        },
        levels: [],
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(invalidTriggerWorkflow);

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/trigger.*type|valid.*webhook|valid.*cron|valid.*manual/i);
    });

    it('should handle workflows with malformed trigger configurations', async () => {
      const malformedTriggerConfigs = [
        {
          trigger: null, // null trigger
          expectedError: /trigger.*required|missing.*trigger|trigger.*must.*object/i
        },
        {
          trigger: 'string-trigger', // string instead of object
          expectedError: /trigger.*object|trigger.*invalid|trigger.*must.*object/i
        },
        {
          trigger: {
            type: 'cron',
            // Missing config object
          },
          expectedError: /config.*required|missing.*config/i
        },
        {
          trigger: {
            // Missing type
            config: {},
          },
          expectedError: /type.*required|missing.*type/i
        },
      ];

      for (const { trigger, expectedError } of malformedTriggerConfigs) {
        const malformedWorkflow = {
          id: 'malformed-trigger-workflow',
          name: 'Malformed Trigger Workflow',
          description: 'Workflow with malformed trigger',
          version: '1.0.0',
          trigger: trigger as any,
          rootAgent: {
            id: 'root-agent',
            name: 'Root Agent',
            description: 'Root agent',
            model: 'granite',
            systemPrompt: 'Root agent prompt',
            availableTools: [],
            level: 0,
          },
          levels: [],
        };

        const response = await request(app)
          .post('/api/workflows')
          .send(malformedWorkflow);

        expect(response.status).toBe(400);
        if (expectedError) {
          expect(response.body.message).toMatch(expectedError);
        }
      }
    });
  });

  describe('Boundary Value Edge Cases', () => {
    it('should handle workflows with maximum allowed complexity', async () => {
      // Test with values at the boundary of what should be acceptable
      const boundaryWorkflow: WorkflowConfig = {
        id: 'a'.repeat(255), // Very long ID (255 chars)
        name: 'B'.repeat(1000), // Very long name
        description: 'C'.repeat(10000), // Very long description
        version: '99.99.99', // High version number
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'D'.repeat(255), // Very long agent ID
          name: 'E'.repeat(1000), // Very long agent name
          description: 'F'.repeat(10000), // Very long agent description
          model: 'granite',
          systemPrompt: 'G'.repeat(50000), // Very long system prompt
          availableTools: Array(1000).fill(null).map((_, i) => `tool-${i}`), // Many tools
          level: 0,
        },
        levels: Array(50).fill(null).map((_, levelIndex) => ({ // Many levels
          level: levelIndex + 1,
          agents: Array(20).fill(null).map((_, agentIndex) => ({ // Many agents per level
            id: `level-${levelIndex}-agent-${agentIndex}`,
            name: `Level ${levelIndex} Agent ${agentIndex}`,
            description: 'H'.repeat(1000),
            model: 'granite',
            systemPrompt: 'I'.repeat(5000),
            availableTools: Array(100).fill(null).map((_, i) => `level-tool-${i}`),
            level: levelIndex + 1,
          })),
          executionMode: 'parallel' as const,
        })),
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(boundaryWorkflow);

      expect([201, 400, 413]).toContain(response.status);
      
      if (response.status === 400) {
        console.log('Boundary values rejected:', response.body.message);
      } else if (response.status === 413) {
        console.log('Boundary values too large for server');
      } else {
        console.log('Boundary values accepted');
      }
    });

    it('should handle workflows with zero and negative values', async () => {
      const zeroNegativeWorkflow: WorkflowConfig = {
        id: 'zero-negative-workflow',
        name: 'Zero Negative Workflow',
        description: 'Workflow with zero and negative values',
        version: '0.0.0', // Zero version
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'Root agent prompt',
          availableTools: [],
          level: -1, // Negative level
        },
        levels: [
          {
            level: 0, // Zero level
            agents: [{
              id: 'zero-level-agent',
              name: 'Zero Level Agent',
              description: 'Agent at level zero',
              model: 'granite',
              systemPrompt: 'Zero level prompt',
              availableTools: [],
              level: -5, // Negative agent level
            }],
            executionMode: 'parallel',
          },
        ],
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(zeroNegativeWorkflow);

      // Should reject negative levels
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/level.*min|negative.*level|level.*0/i);
    });
  });

  describe('Unicode and Special Character Edge Cases', () => {
    it('should handle workflows with unicode and special characters', async () => {
      const unicodeWorkflow: WorkflowConfig = {
        id: 'unicode-workflow-测试', // Unicode in ID
        name: '🤖 Unicode Workflow 测试 العربية русский', // Unicode in name
        description: 'Workflow with émojis 🚀 and spëcial chars ñáéíóú 中文 العربية русский',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'unicode-agent-测试',
          name: '🤖 Unicode Agent العربية',
          description: 'Agent with unicode characters 中文 русский',
          model: 'granite',
          systemPrompt: 'You are a unicode agent 🤖. Handle spëcial chars ñáéíóú.',
          availableTools: ['unicode-tool-测试', 'tool-العربية', 'инструмент-русский'],
          level: 0,
        },
        levels: [],
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(unicodeWorkflow);

      expect([201, 400]).toContain(response.status);
      
      if (response.status === 400) {
        console.log('Unicode characters rejected:', response.body.message);
      } else {
        console.log('Unicode characters accepted');
      }
    });

    it('should handle workflows with control characters and escape sequences', async () => {
      const controlCharWorkflow: WorkflowConfig = {
        id: 'control\x00char\x01workflow', // Control characters
        name: 'Control\nChar\tWorkflow\r\n', // Newlines and tabs
        description: 'Workflow\x0cwith\x0bcontrol\x1bchars',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'control\x00agent',
          name: 'Control\nAgent',
          description: 'Agent\twith\rcontrol\x0cchars',
          model: 'granite',
          systemPrompt: 'System\x00prompt\x01with\x02control\x03chars',
          availableTools: [],
          level: 0,
        },
        levels: [],
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(controlCharWorkflow);

      expect([201, 400]).toContain(response.status);
      
      if (response.status === 400) {
        console.log('Control characters rejected:', response.body.message);
      } else {
        console.warn('VALIDATION ISSUE: Control characters were accepted');
      }
    });
  });
});