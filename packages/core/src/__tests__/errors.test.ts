import {
  ArbiterError,
  WorkflowError,
  AgentError,
  ValidationError,
  RuntimeError,
  ModelError,
} from '../utils/errors';

describe('Error classes', () => {
  describe('ArbiterError', () => {
    it('should create error with message and code', () => {
      const error = new ArbiterError('Test error', 'TEST_CODE');
      
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('ArbiterError');
      expect(error.context).toBeUndefined();
    });

    it('should create error with context', () => {
      const context = { userId: '123', action: 'test' };
      const error = new ArbiterError('Test error', 'TEST_CODE', context);
      
      expect(error.context).toEqual(context);
    });

    it('should be instanceof Error', () => {
      const error = new ArbiterError('Test error', 'TEST_CODE');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ArbiterError);
    });
  });

  describe('WorkflowError', () => {
    it('should create workflow error with workflowId', () => {
      const error = new WorkflowError('Workflow failed', 'workflow-123');
      
      expect(error.message).toBe('Workflow failed');
      expect(error.code).toBe('WORKFLOW_ERROR');
      expect(error.workflowId).toBe('workflow-123');
      expect(error.name).toBe('WorkflowError');
    });

    it('should include workflowId in context', () => {
      const error = new WorkflowError('Workflow failed', 'workflow-123');
      expect(error.context).toEqual({ workflowId: 'workflow-123' });
    });

    it('should merge additional context', () => {
      const additionalContext = { step: 'execution', level: 2 };
      const error = new WorkflowError('Workflow failed', 'workflow-123', additionalContext);
      
      expect(error.context).toEqual({
        workflowId: 'workflow-123',
        step: 'execution',
        level: 2,
      });
    });
  });

  describe('AgentError', () => {
    it('should create agent error with agentId', () => {
      const error = new AgentError('Agent failed', 'agent-456');
      
      expect(error.message).toBe('Agent failed');
      expect(error.code).toBe('AGENT_ERROR');
      expect(error.agentId).toBe('agent-456');
      expect(error.name).toBe('AgentError');
    });

    it('should include agentId in context', () => {
      const error = new AgentError('Agent failed', 'agent-456');
      expect(error.context).toEqual({ agentId: 'agent-456' });
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with validation errors', () => {
      const validationErrors = [
        'Field is required',
        'Invalid format',
        'Value out of range',
      ];
      const error = new ValidationError('Validation failed', validationErrors);
      
      expect(error.message).toBe('Validation failed');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.validationErrors).toEqual(validationErrors);
      expect(error.name).toBe('ValidationError');
    });

    it('should include validation errors in context', () => {
      const validationErrors = ['Error 1', 'Error 2'];
      const error = new ValidationError('Validation failed', validationErrors);
      
      expect(error.context).toEqual({ validationErrors });
    });
  });

  describe('RuntimeError', () => {
    it('should create runtime error with runtime type', () => {
      const error = new RuntimeError('Runtime failed', 'node');
      
      expect(error.message).toBe('Runtime failed');
      expect(error.code).toBe('RUNTIME_ERROR');
      expect(error.runtimeType).toBe('node');
      expect(error.name).toBe('RuntimeError');
    });

    it('should include runtime type in context', () => {
      const error = new RuntimeError('Runtime failed', 'python');
      expect(error.context).toEqual({ runtimeType: 'python' });
    });
  });

  describe('ModelError', () => {
    it('should create model error with model name', () => {
      const error = new ModelError('Model failed', 'granite');
      
      expect(error.message).toBe('Model failed');
      expect(error.code).toBe('MODEL_ERROR');
      expect(error.model).toBe('granite');
      expect(error.name).toBe('ModelError');
    });

    it('should include model in context', () => {
      const error = new ModelError('Model failed', 'granite');
      expect(error.context).toEqual({ model: 'granite' });
    });

    it('should merge additional context', () => {
      const additionalContext = { apiCall: 'chat/completions', status: 500 };
      const error = new ModelError('API error', 'openai', additionalContext);
      
      expect(error.context).toEqual({
        model: 'openai',
        apiCall: 'chat/completions',
        status: 500,
      });
    });
  });

  describe('Error inheritance', () => {
    it('should maintain proper inheritance chain', () => {
      const workflowError = new WorkflowError('Test', 'workflow-123');
      const agentError = new AgentError('Test', 'agent-456');
      const validationError = new ValidationError('Test', []);
      const runtimeError = new RuntimeError('Test', 'node');
      const modelError = new ModelError('Test', 'granite');
      
      // All should be instances of their specific type
      expect(workflowError).toBeInstanceOf(WorkflowError);
      expect(agentError).toBeInstanceOf(AgentError);
      expect(validationError).toBeInstanceOf(ValidationError);
      expect(runtimeError).toBeInstanceOf(RuntimeError);
      expect(modelError).toBeInstanceOf(ModelError);
      
      // All should be instances of ArbiterError
      expect(workflowError).toBeInstanceOf(ArbiterError);
      expect(agentError).toBeInstanceOf(ArbiterError);
      expect(validationError).toBeInstanceOf(ArbiterError);
      expect(runtimeError).toBeInstanceOf(ArbiterError);
      expect(modelError).toBeInstanceOf(ArbiterError);
      
      // All should be instances of Error
      expect(workflowError).toBeInstanceOf(Error);
      expect(agentError).toBeInstanceOf(Error);
      expect(validationError).toBeInstanceOf(Error);
      expect(runtimeError).toBeInstanceOf(Error);
      expect(modelError).toBeInstanceOf(Error);
    });
  });

  describe('Error serialization', () => {
    it('should serialize errors properly', () => {
      const error = new WorkflowError('Test error', 'workflow-123', {
        step: 'execution',
        level: 2,
      });
      
      const serialized = JSON.stringify(error);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.message).toBe('Test error');
      expect(parsed.code).toBe('WORKFLOW_ERROR');
      expect(parsed.workflowId).toBe('workflow-123');
      expect(parsed.context).toEqual({
        workflowId: 'workflow-123',
        step: 'execution',
        level: 2,
      });
    });
  });
});