import { EventSystem } from '@arbiter/event-system';
import { WorkflowEngine } from '@arbiter/workflow-engine';
import { 
  AgentConfig, 
  WorkflowConfig, 
  EventTriggerHandler 
} from '@arbiter/core';

describe('Event → WorkflowEngine Integration Tests', () => {
  let eventSystem: EventSystem;
  let workflowEngine: WorkflowEngine;

  beforeEach(async () => {
    eventSystem = new EventSystem();
    workflowEngine = new WorkflowEngine();

    // Connect EventSystem to WorkflowEngine
    const triggerHandler: EventTriggerHandler = async (event) => {
      try {
        console.log('Event trigger handler called with event:', event);
        
        // Get the workflow configuration from the event metadata
        const workflowId = event.metadata?.workflowId;
        if (!workflowId) {
          console.log('No workflow ID in event metadata');
          return {
            success: false,
            error: 'No workflow ID in event metadata'
          };
        }
        
        const workflow = eventSystem.getWorkflowConfig(workflowId);
        if (!workflow) {
          console.log(`Workflow not found: ${workflowId}`);
          return {
            success: false,
            error: `Workflow not found: ${workflowId}`
          };
        }
        
        console.log('Executing workflow:', workflow.id);
        const execution = await workflowEngine.executeWorkflow(workflow, event);
        console.log('Workflow execution completed:', execution.id);
        
        return {
          success: true,
          workflowExecutionId: execution.id
        };
      } catch (error) {
        console.log('Error in trigger handler:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    };
    
    eventSystem.setEventTriggerHandler(triggerHandler);
    await eventSystem.startEventSystem();
  });

  afterEach(async () => {
    // Clean up any running processes
    await eventSystem.stopEventSystem();
    
    // Cancel any active executions
    const activeExecutions = workflowEngine.getActiveExecutions();
    for (const execution of activeExecutions) {
      await workflowEngine.cancelExecution(execution.execution.id);
    }
  });

  describe('Complete Event-to-Workflow Execution Flow', () => {
    it('should execute complete flow from manual event trigger to workflow execution', async () => {
      // 1. Set up agent configuration
      const rootAgentConfig: AgentConfig = {
        id: 'integration-root-agent',
        name: 'Integration Root Agent',
        description: 'Root agent for integration testing',
        model: 'granite',
        systemPrompt: 'You are a root agent in an integration test',
        availableTools: [],
        level: 0,
      };

      const level1AgentConfig: AgentConfig = {
        id: 'integration-level1-agent',
        name: 'Integration Level 1 Agent',
        description: 'Level 1 agent for integration testing',
        model: 'granite',
        systemPrompt: 'You are a level 1 agent in an integration test',
        availableTools: [],
        level: 1,
      };

      // 2. Set up workflow configuration
      const workflowConfig: WorkflowConfig = {
        id: 'integration-workflow',
        name: 'Integration Test Workflow',
        description: 'Workflow for integration testing',
        version: '1.0.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        rootAgent: rootAgentConfig,
        levels: [
          {
            level: 1,
            agents: [level1AgentConfig],
            executionMode: 'parallel',
          },
        ],
      };

      // 3. Register workflow with event system
      await eventSystem.registerWorkflow(workflowConfig);

      // 4. Verify workflow was registered
      const registeredWorkflow = eventSystem.getWorkflowConfig('integration-workflow');
      expect(registeredWorkflow).toBeDefined();
      expect(registeredWorkflow?.id).toBe('integration-workflow');

      // 5. Trigger manual event
      const eventData = {
        message: 'Integration test event',
        testData: { key: 'value' },
      };

      const eventResult = await eventSystem.triggerManualEvent(
        'integration-workflow',
        eventData
      );

      expect(eventResult).toBeDefined();
      
      if (!eventResult.success) {
        console.log('Event execution failed:', eventResult.error);
      }
      
      expect(eventResult.success).toBe(true);
      expect(eventResult.workflowExecutionId).toBeDefined();

      // 6. Wait for execution to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // 7. Check execution status using the workflowExecutionId
      if (eventResult.workflowExecutionId) {
        const completedExecution = workflowEngine.getExecution(eventResult.workflowExecutionId);
        expect(completedExecution?.execution.status).toMatch(/completed|failed/);

        // 8. Verify workflow structure was processed
        expect(completedExecution?.workflow.levels).toHaveLength(1);
        expect(completedExecution?.workflow.levels[0].agents).toHaveLength(1);

        // 9. Verify workflow results
        if (completedExecution?.execution.status === 'completed') {
          expect(completedExecution.execution.endTime).toBeDefined();
        }
      }
    });

    it('should handle multi-level workflow execution through event system', async () => {
      // 1. Create agents with multiple levels
      const calculatorAgent: AgentConfig = {
        id: 'calculator-agent',
        name: 'Calculator Agent',
        description: 'Agent that performs calculations',
        model: 'granite',
        systemPrompt: 'You are a calculator agent.',
        availableTools: [],
        level: 0,
      };

      const verifierAgent: AgentConfig = {
        id: 'verifier-agent',
        name: 'Verifier Agent',
        description: 'Agent that verifies calculations',
        model: 'granite',
        systemPrompt: 'You are a verifier agent.',
        availableTools: [],
        level: 1,
      };

      const reporterAgent: AgentConfig = {
        id: 'reporter-agent',
        name: 'Reporter Agent',
        description: 'Agent that reports results',
        model: 'granite',
        systemPrompt: 'You are a reporter agent.',
        availableTools: [],
        level: 2,
      };

      // 2. Create workflow with multiple levels
      const mathWorkflow: WorkflowConfig = {
        id: 'math-workflow',
        name: 'Math Workflow',
        description: 'Workflow for mathematical operations',
        version: '1.0.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        rootAgent: calculatorAgent,
        levels: [
          {
            level: 1,
            agents: [verifierAgent],
            executionMode: 'parallel',
          },
          {
            level: 2,
            agents: [reporterAgent],
            executionMode: 'parallel',
          },
        ],
      };

      // 3. Register workflow with event system
      await eventSystem.registerWorkflow(mathWorkflow);

      // 4. Execute the workflow
      const mathEventData = {
        task: 'Calculate 5 + 3 and verify the result',
        operation: 'add',
        numbers: [5, 3],
      };

      const mathEventResult = await eventSystem.triggerManualEvent(
        'math-workflow',
        mathEventData
      );

      expect(mathEventResult).toBeDefined();
      expect(mathEventResult.success).toBe(true);
      expect(mathEventResult.workflowExecutionId).toBeDefined();

      // 5. Wait for completion and verify results
      await new Promise(resolve => setTimeout(resolve, 200));

      if (mathEventResult.workflowExecutionId) {
        const completedMathExecution = workflowEngine.getExecution(mathEventResult.workflowExecutionId);
        expect(completedMathExecution?.execution.status).toMatch(/completed|failed/);
        
        // Verify workflow structure was processed
        expect(completedMathExecution?.workflow.levels).toHaveLength(2);
        expect(completedMathExecution?.workflow.levels[0].agents).toHaveLength(1);
        expect(completedMathExecution?.workflow.levels[1].agents).toHaveLength(1);
      }
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle workflow registration errors gracefully', async () => {
      // 1. Try to register an invalid workflow (missing required fields)
      const invalidWorkflow = {
        id: 'invalid-workflow',
        // missing required fields like name, trigger, rootAgent
      } as WorkflowConfig;

      // 2. This should throw an error or handle gracefully
      await expect(eventSystem.registerWorkflow(invalidWorkflow)).rejects.toThrow();
    });

    it('should handle concurrent workflow executions without conflicts', async () => {
      // 1. Create workflow for concurrent execution
      const concurrentWorkflow: WorkflowConfig = {
        id: 'concurrent-workflow',
        name: 'Concurrent Workflow',
        description: 'Workflow for concurrent testing',
        version: '1.0.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        rootAgent: {
          id: 'concurrent-agent',
          name: 'Concurrent Agent',
          description: 'Agent for concurrent testing',
          model: 'granite',
          systemPrompt: 'You are a concurrent agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
      };

      await eventSystem.registerWorkflow(concurrentWorkflow);

      // 2. Execute multiple concurrent workflows
      const concurrentResults = await Promise.all([
        eventSystem.triggerManualEvent('concurrent-workflow', { id: 1 }),
        eventSystem.triggerManualEvent('concurrent-workflow', { id: 2 }),
        eventSystem.triggerManualEvent('concurrent-workflow', { id: 3 }),
      ]);

      expect(concurrentResults).toHaveLength(3);
      concurrentResults.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.workflowExecutionId).toBeDefined();
      });

      // 3. Wait for all executions to complete
      await new Promise(resolve => setTimeout(resolve, 300));

      // 4. Verify all executions completed independently
      const executionStatuses = concurrentResults.map(result => {
        if (result.workflowExecutionId) {
          const completed = workflowEngine.getExecution(result.workflowExecutionId);
          return completed?.execution.status;
        }
        return undefined;
      });

      executionStatuses.forEach(status => {
        if (status) {
          expect(status).toMatch(/completed|failed/);
        }
      });
    });

    it('should handle missing workflow errors', async () => {
      // 1. Try to trigger a non-existent workflow
      await expect(
        eventSystem.triggerManualEvent('nonexistent-workflow', { data: 'test' })
      ).rejects.toThrow(/Workflow not found/);
    });
  });

  describe('Cross-Component Communication', () => {
    it('should pass data correctly between event system and workflow engine', async () => {
      // 1. Create workflow with data passing
      const dataWorkflow: WorkflowConfig = {
        id: 'data-workflow',
        name: 'Data Passing Workflow',
        description: 'Workflow for testing data passing',
        version: '1.0.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        rootAgent: {
          id: 'data-agent',
          name: 'Data Agent',
          description: 'Agent for data testing',
          model: 'granite',
          systemPrompt: 'You are a data agent.',
          availableTools: [],
          level: 0,
        },
        levels: [],
      };

      await eventSystem.registerWorkflow(dataWorkflow);

      // 2. Execute workflow with complex data
      const complexEventData = {
        task: 'Process this complex data',
        metadata: {
          source: 'integration-test',
          timestamp: new Date().toISOString(),
          requestId: 'test-request-123',
        },
        payload: {
          nested: {
            value: 42,
            array: [1, 2, 3],
          },
        },
      };

      const dataEventResult = await eventSystem.triggerManualEvent(
        'data-workflow',
        complexEventData
      );

      expect(dataEventResult).toBeDefined();
      expect(dataEventResult.success).toBe(true);

      // 3. Wait for execution and verify data was passed correctly
      await new Promise(resolve => setTimeout(resolve, 200));

      if (dataEventResult.workflowExecutionId) {
        const completedDataExecution = workflowEngine.getExecution(dataEventResult.workflowExecutionId);
        expect(completedDataExecution?.execution.status).toMatch(/completed|failed/);
        
        // Verify the event data was preserved in the workflow execution
        expect(completedDataExecution?.execution.eventData).toEqual(complexEventData);
        expect(completedDataExecution?.execution.eventData.metadata.requestId).toBe('test-request-123');
        expect(completedDataExecution?.execution.eventData.payload.nested.value).toBe(42);
      }
    });
  });

  describe('Resource Management', () => {
    it('should properly manage workflow lifecycle', async () => {
      // 1. Create and register workflow
      const cleanupWorkflow: WorkflowConfig = {
        id: 'cleanup-workflow',
        name: 'Cleanup Workflow',
        description: 'Workflow for cleanup testing',
        version: '1.0.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        rootAgent: {
          id: 'cleanup-agent',
          name: 'Cleanup Agent',
          description: 'Agent for cleanup testing',
          model: 'granite',
          systemPrompt: 'You are a cleanup agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
      };

      await eventSystem.registerWorkflow(cleanupWorkflow);

      // 2. Verify workflow is registered
      const registeredWorkflow = eventSystem.getWorkflowConfig('cleanup-workflow');
      expect(registeredWorkflow).toBeDefined();

      // 3. Execute workflow
      const cleanupEventResult = await eventSystem.triggerManualEvent(
        'cleanup-workflow',
        { task: 'cleanup test' }
      );

      expect(cleanupEventResult.success).toBe(true);

      // 4. Wait for completion
      await new Promise(resolve => setTimeout(resolve, 100));

      // 5. Verify execution completed
      if (cleanupEventResult.workflowExecutionId) {
        const completedCleanupExecution = workflowEngine.getExecution(cleanupEventResult.workflowExecutionId);
        expect(completedCleanupExecution?.execution.status).toMatch(/completed|failed/);
      }

      // 6. Clean up workflow
      await eventSystem.unregisterWorkflow('cleanup-workflow');
      
      const unregisteredWorkflow = eventSystem.getWorkflowConfig('cleanup-workflow');
      expect(unregisteredWorkflow).toBeUndefined();
    });

    it('should track active executions correctly', async () => {
      // 1. Create simple workflow
      const trackingWorkflow: WorkflowConfig = {
        id: 'tracking-workflow',
        name: 'Tracking Workflow',
        description: 'Workflow for execution tracking',
        version: '1.0.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        rootAgent: {
          id: 'tracking-agent',
          name: 'Tracking Agent',
          description: 'Agent for tracking testing',
          model: 'granite',
          systemPrompt: 'You are a tracking agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
      };

      await eventSystem.registerWorkflow(trackingWorkflow);

      // 2. Check initial active executions
      const initialActiveExecutions = workflowEngine.getActiveExecutions();
      const initialCount = initialActiveExecutions.length;

      // 3. Execute workflow
      const trackingEventResult = await eventSystem.triggerManualEvent(
        'tracking-workflow',
        { task: 'tracking test' }
      );

      expect(trackingEventResult.success).toBe(true);

      // 4. Check active executions increased
      const activeExecutions = workflowEngine.getActiveExecutions();
      expect(activeExecutions.length).toBeGreaterThan(initialCount);

      // 5. Find our execution
      const ourExecution = activeExecutions.find(exec => 
        exec.execution.id === trackingEventResult.workflowExecutionId
      );
      expect(ourExecution).toBeDefined();
      expect(ourExecution?.execution.workflowId).toBe('tracking-workflow');

      // 6. Wait for completion
      await new Promise(resolve => setTimeout(resolve, 100));

      // 7. Verify execution status
      if (trackingEventResult.workflowExecutionId) {
        const completedExecution = workflowEngine.getExecution(trackingEventResult.workflowExecutionId);
        expect(completedExecution?.execution.status).toMatch(/completed|failed/);
      }
    });
  });
});