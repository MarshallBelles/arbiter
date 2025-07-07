import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitizes HTML content to prevent XSS attacks
 */
export function sanitizeHtml(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });
}

/**
 * Sanitizes text content to prevent command injection
 */
export function sanitizeCommandInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Remove dangerous command injection patterns
  const dangerousPatterns = [
    /[;&|`$(){}[\]\\]/g,  // Shell metacharacters
    /\.\./g,              // Directory traversal
    /\s*rm\s+/gi,         // Remove commands
    /\s*wget\s+/gi,       // Download commands
    /\s*curl\s+/gi,       // Download commands
    /\s*nc\s+/gi,         // Netcat
    /\s*cat\s+/gi,        // Cat commands
    /\s*chmod\s+/gi,      // Permission changes
    /\s*chown\s+/gi,      // Ownership changes
    /\s*sudo\s+/gi,       // Sudo commands
    /\s*su\s+/gi,         // Switch user
    /\/etc\/passwd/gi,    // System files
    /\/etc\/shadow/gi,    // System files
    /\/proc\//gi,         // Process filesystem
    /\/dev\//gi,          // Device files
  ];
  
  let sanitized = input;
  dangerousPatterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '');
  });
  
  return sanitized.trim();
}

/**
 * Sanitizes an object recursively to prevent XSS and command injection
 */
export function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    // Apply both HTML and command sanitization
    const htmlSanitized = sanitizeHtml(obj);
    return sanitizeCommandInput(htmlSanitized);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = sanitizeHtml(key);
      sanitized[sanitizedKey] = sanitizeObject(value);
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Sanitizes agent configuration to prevent XSS and command injection
 */
export function sanitizeAgentConfig(config: any): any {
  if (!config || typeof config !== 'object') {
    return config;
  }
  
  const sanitized = { ...config };
  
  // Sanitize critical fields that could contain malicious content
  if (sanitized.name) {
    sanitized.name = sanitizeHtml(sanitized.name);
  }
  
  if (sanitized.description) {
    sanitized.description = sanitizeHtml(sanitized.description);
  }
  
  if (sanitized.systemPrompt) {
    sanitized.systemPrompt = sanitizeCommandInput(sanitized.systemPrompt);
  }
  
  // Sanitize metadata recursively
  if (sanitized.metadata) {
    sanitized.metadata = sanitizeObject(sanitized.metadata);
  }
  
  return sanitized;
}

/**
 * Sanitizes workflow configuration to prevent XSS and command injection
 */
export function sanitizeWorkflowConfig(config: any): any {
  if (!config || typeof config !== 'object') {
    return config;
  }
  
  const sanitized = { ...config };
  
  // Sanitize basic fields
  if (sanitized.name) {
    sanitized.name = sanitizeHtml(sanitized.name);
  }
  
  if (sanitized.description) {
    sanitized.description = sanitizeHtml(sanitized.description);
  }
  
  if (sanitized.userPrompt) {
    sanitized.userPrompt = sanitizeCommandInput(sanitized.userPrompt);
  }
  
  // Sanitize root agent
  if (sanitized.rootAgent) {
    sanitized.rootAgent = sanitizeAgentConfig(sanitized.rootAgent);
  }
  
  // Sanitize level agents
  if (sanitized.levels && Array.isArray(sanitized.levels)) {
    sanitized.levels = sanitized.levels.map((level: any) => {
      if (level.agents && Array.isArray(level.agents)) {
        level.agents = level.agents.map((agent: any) => sanitizeAgentConfig(agent));
      }
      return level;
    });
  }
  
  // Sanitize metadata recursively
  if (sanitized.metadata) {
    sanitized.metadata = sanitizeObject(sanitized.metadata);
  }
  
  return sanitized;
}

/**
 * Sanitizes execution input data to prevent command injection
 */
export function sanitizeExecutionInput(input: any): any {
  if (!input) {
    return input;
  }
  
  return sanitizeObject(input);
}