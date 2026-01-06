// Workflow Trigger System Types
// Defines types for the 4 trigger types and autonomy levels

import type {
  TriggerType,
  AutonomyLevel,
  TriggerStatus,
  TriggerExecutionStatus,
  ConfirmationStatus,
} from '@prisma/client';

// Re-export Prisma enums for convenience
export {
  TriggerType,
  AutonomyLevel,
  TriggerStatus,
  TriggerExecutionStatus,
  ConfirmationStatus,
};

// ==========================================
// Config Types by Trigger Type
// ==========================================

export interface TimeConfig {
  cron_expr?: string;
  run_at?: string; // ISO datetime for one-time
  timezone: string;
  is_one_time: boolean;
}

export interface EventConfig {
  event_source: 'email' | 'outlook' | 'internal';
  event_type: string;
  filters?: Record<string, unknown>;
  debounce_seconds?: number;
}

export interface ConditionConfig {
  poll_interval_minutes: number;
  data_source: {
    type: 'http' | 'internal';
    url?: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: unknown;
  };
  condition: {
    expression: string; // e.g., "balance < 100"
    extract_path?: string; // JSONPath to extract value
  };
  trigger_on_change_only?: boolean;
}

export interface WebhookConfig {
  signature_type?: 'hmac-sha256' | 'hmac-sha1' | 'none';
  signature_header?: string;
  payload_path?: string; // JSONPath to extract relevant data
}

export type TriggerConfig = TimeConfig | EventConfig | ConditionConfig | WebhookConfig;

// ==========================================
// Event Types
// ==========================================

export interface TriggerEvent {
  triggerId: string;
  tenantId: string;
  userPhone: string;
  triggerType: TriggerType;
  autonomy: AutonomyLevel;
  taskPrompt: string;
  payload: TriggerPayload;
  timestamp: Date;
}

export interface TriggerPayload {
  source: string;
  data: unknown;
  metadata?: Record<string, unknown>;
}

// ==========================================
// Adapter Interface
// ==========================================

export type TriggerCallback = (event: TriggerEvent) => Promise<void>;

export interface EventSourceAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onTrigger(callback: TriggerCallback): void;
}

// ==========================================
// Internal Event Bus Types
// ==========================================

export type InternalEventType =
  | 'message.received'
  | 'message.sent'
  | 'task.completed'
  | 'task.failed'
  | 'session.created'
  | 'session.ended'
  | 'email.received';

export interface InternalEvent {
  type: InternalEventType;
  tenantId: string;
  data: unknown;
  timestamp: Date;
}

// ==========================================
// Safe Expression Evaluation Types
// ==========================================

export type ComparisonOperator = '<' | '>' | '<=' | '>=' | '==' | '!=' | 'contains' | 'startsWith' | 'endsWith';

export interface ParsedCondition {
  left: string;
  operator: ComparisonOperator;
  right: string | number | boolean;
}

// ==========================================
// API Request/Response Types
// ==========================================

export interface CreateTriggerRequest {
  name: string;
  description?: string;
  trigger_type: TriggerType;
  config: TriggerConfig;
  task_prompt: string;
  autonomy?: AutonomyLevel;
  cooldown_seconds?: number;
}

export interface UpdateTriggerRequest {
  name?: string;
  description?: string;
  config?: Partial<TriggerConfig>;
  task_prompt?: string;
  autonomy?: AutonomyLevel;
  cooldown_seconds?: number;
}

export interface TriggerResponse {
  id: string;
  name: string;
  description: string | null;
  trigger_type: TriggerType;
  config: TriggerConfig;
  task_prompt: string;
  autonomy: AutonomyLevel;
  status: TriggerStatus;
  cooldown_seconds: number;
  webhook_url?: string;
  last_triggered_at: string | null;
  created_at: string;
}

export interface ConfirmationRequest {
  execution_id: string;
  approved: boolean;
}

export interface PendingConfirmation {
  execution_id: string;
  trigger_name: string;
  task_prompt: string;
  triggered_by: string;
  deadline: string;
  created_at: string;
}

// ==========================================
// Webhook Receiver Types
// ==========================================

export interface ExternalWebhookPayload {
  [key: string]: unknown;
}

export interface WebhookHeaders {
  'x-signature'?: string;
  'x-hub-signature-256'?: string;
  'x-idempotency-key'?: string;
  [key: string]: string | undefined;
}
