export interface ArbiterEvent {
  id: string;
  type: string;
  source: string;
  timestamp: Date;
  data: any;
  metadata?: Record<string, any>;
}

export interface EventHandler {
  id: string;
  eventType: string;
  workflowId: string;
  condition?: string;
  enabled: boolean;
  lastTriggered?: Date;
  triggerCount: number;
}

export interface EventProcessingResult {
  success: boolean;
  workflowExecutionId?: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
}