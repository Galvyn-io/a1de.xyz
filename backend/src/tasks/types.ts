// Core task types and handler interface

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskRow {
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

// What a handler returns when starting a task
export interface RunResult {
  external_provider?: string;
  external_id?: string;
  // If task completes immediately (synchronous), set status and output
  status?: TaskStatus;
  output?: Record<string, unknown>;
  progress_message?: string;
}

// What a poll returns
export interface PollResult {
  status: TaskStatus;
  output?: Record<string, unknown>;
  error?: string;
  progress_message?: string;
  progress_pct?: number;
}

export interface TaskHandler {
  type: string;                             // e.g. 'golf.search'
  provider?: string;                        // e.g. 'skyvern' (for webhook routing)

  // Start the task (create external resource if any)
  run(task: TaskRow): Promise<RunResult>;

  // Check status of an external task (called by polling worker)
  poll?(task: TaskRow): Promise<PollResult>;

  // Called when task reaches completed status — side effects like saving memory,
  // injecting into chat, triggering follow-up tasks
  onComplete?(task: TaskRow): Promise<void>;

  // Called when task fails
  onFailed?(task: TaskRow): Promise<void>;
}
