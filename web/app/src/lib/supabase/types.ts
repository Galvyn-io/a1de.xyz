export interface UserProfile {
  id: string;
  email: string;
  assistant_name: string | null;
  is_registered: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export type ConnectorType = 'email' | 'calendar' | 'photos' | 'banking' | 'health';
export type ConnectorProvider = 'gmail' | 'google_calendar' | 'google_photos' | 'plaid' | 'whoop' | 'apple_health';
export type ConnectorStatus = 'active' | 'error' | 'disconnected';

export interface Connector {
  id: string;
  user_id: string;
  credential_id: string;
  type: ConnectorType;
  provider: ConnectorProvider;
  label: string;
  status: ConnectorStatus;
  status_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  user_id: string;
  role: MessageRole;
  content: string | null;
  tool_calls: unknown | null;
  tool_result: unknown | null;
  model: string | null;
  created_at: string;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  user_id: string;
  type: string;
  status: TaskStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  external_provider: string | null;
  external_id: string | null;
  progress_message: string | null;
  progress_pct: number | null;
  conversation_id: string | null;
  schedule_id: string | null;
  parent_task_id: string | null;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}
