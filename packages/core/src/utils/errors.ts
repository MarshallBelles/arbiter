export class ArbiterError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'ArbiterError';
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack,
    };
  }
}

export class WorkflowError extends ArbiterError {
  constructor(message: string, public workflowId: string, context?: Record<string, any>) {
    super(message, 'WORKFLOW_ERROR', { workflowId, ...context });
    this.name = 'WorkflowError';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      workflowId: this.workflowId,
    };
  }
}

export class AgentError extends ArbiterError {
  constructor(message: string, public agentId: string, context?: Record<string, any>) {
    super(message, 'AGENT_ERROR', { agentId, ...context });
    this.name = 'AgentError';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      agentId: this.agentId,
    };
  }
}

export class ValidationError extends ArbiterError {
  constructor(message: string, public validationErrors: string[]) {
    super(message, 'VALIDATION_ERROR', { validationErrors });
    this.name = 'ValidationError';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      validationErrors: this.validationErrors,
    };
  }
}

export class RuntimeError extends ArbiterError {
  constructor(message: string, public runtimeType: string, context?: Record<string, any>) {
    super(message, 'RUNTIME_ERROR', { runtimeType, ...context });
    this.name = 'RuntimeError';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      runtimeType: this.runtimeType,
    };
  }
}

export class ModelError extends ArbiterError {
  constructor(message: string, public model: string, context?: Record<string, any>) {
    super(message, 'MODEL_ERROR', { model, ...context });
    this.name = 'ModelError';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      model: this.model,
    };
  }
}