import { AgentConfig, WorkflowConfig } from '../types/index';

export function validateAgentConfig(config: AgentConfig): string[] {
  const errors: string[] = [];

  if (!config.id || typeof config.id !== 'string') {
    errors.push('Agent ID is required and must be a string');
  }

  if (!config.name || typeof config.name !== 'string') {
    errors.push('Agent name is required and must be a string');
  }

  if (!config.model || typeof config.model !== 'string') {
    errors.push('Agent model is required and must be a string');
  }

  if (!config.systemPrompt || typeof config.systemPrompt !== 'string') {
    errors.push('Agent system prompt is required and must be a string');
  }

  if (typeof config.level !== 'number' || config.level < 0) {
    errors.push('Agent level must be a non-negative number');
  }

  if (!Array.isArray(config.availableTools)) {
    errors.push('Available tools must be an array');
  }

  return errors;
}

export function validateWorkflowConfig(config: WorkflowConfig): string[] {
  const errors: string[] = [];

  if (!config.id || typeof config.id !== 'string') {
    errors.push('Workflow ID is required and must be a string');
  }

  if (!config.name || typeof config.name !== 'string') {
    errors.push('Workflow name is required and must be a string');
  }

  if (!config.rootAgent) {
    errors.push('Root agent is required');
  } else {
    errors.push(...validateAgentConfig(config.rootAgent));
  }

  if (!config.trigger) {
    errors.push('Workflow trigger is required');
  } else {
    errors.push(...validateEventTrigger(config.trigger));
  }

  if (!Array.isArray(config.levels)) {
    errors.push('Workflow levels must be an array');
  }

  return errors;
}

export function validateEventTrigger(trigger: any): string[] {
  const errors: string[] = [];

  if (!trigger.type || !['webhook', 'cron', 'manual', 'file-watch', 'api'].includes(trigger.type)) {
    errors.push('Trigger type must be one of: webhook, cron, manual, file-watch, api');
  }

  if (!trigger.config || typeof trigger.config !== 'object') {
    errors.push('Trigger config is required and must be an object');
  }

  return errors;
}

export function validateJSON(jsonString: string): { valid: boolean; parsed?: any; error?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    return { valid: true, parsed };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
}