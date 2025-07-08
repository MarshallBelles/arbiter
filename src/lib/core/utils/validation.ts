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
    // Clean the JSON string to handle common llama.cpp issues
    const cleanedJson = cleanJSONString(jsonString);
    const parsed = JSON.parse(cleanedJson);
    return { valid: true, parsed };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
}

function cleanJSONString(jsonString: string): string {
  // Remove any leading/trailing whitespace
  let cleaned = jsonString.trim();
  
  // Handle common llama.cpp JSON issues:
  
  // 0. Remove word boundary characters that llama.cpp sometimes inserts
  cleaned = cleaned.replace(/\\b/g, '');
  
  // 1. Fix unescaped newlines within string values
  // This regex finds string values and escapes any unescaped newlines within them
  cleaned = cleaned.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (_match, content) => {
    // Escape unescaped newlines and other control characters
    const escapedContent = content
      .replace(/(?<!\\)\n/g, '\\n')  // Escape unescaped newlines
      .replace(/(?<!\\)\r/g, '\\r')  // Escape unescaped carriage returns
      .replace(/(?<!\\)\t/g, '\\t')  // Escape unescaped tabs
      .replace(/(?<!\\)\f/g, '\\f'); // Escape unescaped form feeds
      // NOTE: Don't escape \b (backspace) as it conflicts with word boundaries
    
    return `"${escapedContent}"`;
  });
  
  // 2. Handle truncated JSON by attempting to close incomplete structures
  const openBraces = (cleaned.match(/\{/g) || []).length;
  const closeBraces = (cleaned.match(/\}/g) || []).length;
  const openBrackets = (cleaned.match(/\[/g) || []).length;
  const closeBrackets = (cleaned.match(/\]/g) || []).length;
  
  // Add missing closing braces
  for (let i = 0; i < openBraces - closeBraces; i++) {
    cleaned += '}';
  }
  
  // Add missing closing brackets
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    cleaned += ']';
  }
  
  // 3. Handle incomplete string literals at the end
  const lastQuoteIndex = cleaned.lastIndexOf('"');
  
  // If we have an odd number of quotes or an incomplete string at the end
  if (lastQuoteIndex > -1) {
    const afterLastQuote = cleaned.substring(lastQuoteIndex + 1);
    // If there's content after the last quote that isn't valid JSON structure
    if (afterLastQuote && !afterLastQuote.match(/^\s*[,\}\]]*\s*$/)) {
      // Close the incomplete string
      cleaned = cleaned.substring(0, lastQuoteIndex + 1) + '"' + 
                cleaned.substring(lastQuoteIndex + 1).replace(/[^,\}\]\s]/g, '');
    }
  }
  
  return cleaned;
}