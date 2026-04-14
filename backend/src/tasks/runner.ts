// Task runner: executes tasks via their registered handler

import { getTask, insertTask, updateTask, listRunningTasks } from './db.js';
import { getHandler } from './registry.js';
import type { TaskRow } from './types.js';

export interface CreateTaskParams {
  userId: string;
  type: string;
  input?: Record<string, unknown>;
  conversationId?: string;
  scheduleId?: string;
  parentTaskId?: string;
  scheduledFor?: Date;
  runImmediately?: boolean; // default true — if false, task stays pending until runner picks it up
}

// Create a task and (by default) kick off execution
export async function createTask(params: CreateTaskParams): Promise<TaskRow> {
  const task = await insertTask(params);

  if (params.runImmediately !== false && !params.scheduledFor) {
    // Fire and forget — run in background
    runTask(task.id).catch((err) => {
      console.error(`[tasks] failed to run task ${task.id}:`, err);
    });
  }

  return task;
}

// Execute a task's handler
export async function runTask(taskId: string): Promise<TaskRow> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const handler = getHandler(task.type);
  if (!handler) {
    return updateTask(taskId, {
      status: 'failed',
      error: `No handler registered for task type: ${task.type}`,
      completed_at: new Date().toISOString(),
    });
  }

  // Mark as running
  const started = await updateTask(taskId, {
    status: 'running',
    started_at: new Date().toISOString(),
  });

  try {
    const result = await handler.run(started);

    // If handler completed synchronously (no external_id), finalize now
    if (result.status === 'completed' || result.status === 'failed') {
      const finalStatus = result.status;
      const updated = await updateTask(taskId, {
        status: finalStatus,
        output: result.output ?? null,
        external_provider: result.external_provider ?? null,
        external_id: result.external_id ?? null,
        progress_message: result.progress_message ?? null,
        completed_at: new Date().toISOString(),
      });

      if (finalStatus === 'completed' && handler.onComplete) {
        await handler.onComplete(updated).catch((err) => {
          console.error(`[tasks] onComplete failed for ${taskId}:`, err);
        });
      } else if (finalStatus === 'failed' && handler.onFailed) {
        await handler.onFailed(updated).catch((err) => {
          console.error(`[tasks] onFailed failed for ${taskId}:`, err);
        });
      }

      return updated;
    }

    // Otherwise it's an async task — external service will update status later
    return updateTask(taskId, {
      external_provider: result.external_provider ?? null,
      external_id: result.external_id ?? null,
      progress_message: result.progress_message ?? null,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[tasks] task ${taskId} failed in handler.run:`, err);

    const updated = await updateTask(taskId, {
      status: 'failed',
      error: errorMsg,
      completed_at: new Date().toISOString(),
    });

    if (handler.onFailed) {
      await handler.onFailed(updated).catch((e) => {
        console.error(`[tasks] onFailed failed for ${taskId}:`, e);
      });
    }

    return updated;
  }
}

// Poll external services for tasks that are still running
// Called periodically by the polling worker
export async function pollRunningTasks(): Promise<{ polled: number; completed: number }> {
  const tasks = await listRunningTasks(30);
  let completed = 0;

  for (const task of tasks) {
    const handler = getHandler(task.type);
    if (!handler?.poll) continue;

    try {
      const result = await handler.poll(task);

      // Always touch updated_at so we don't keep polling the same task every run
      const updated = await updateTask(task.id, {
        status: result.status,
        output: result.output ?? task.output,
        error: result.error ?? task.error,
        progress_message: result.progress_message ?? task.progress_message,
        progress_pct: result.progress_pct ?? task.progress_pct,
        completed_at:
          result.status === 'completed' || result.status === 'failed' || result.status === 'cancelled'
            ? new Date().toISOString()
            : null,
      });

      if (result.status === 'completed') {
        completed++;
        if (handler.onComplete) {
          await handler.onComplete(updated).catch((err) => {
            console.error(`[tasks] onComplete failed for ${task.id}:`, err);
          });
        }
      } else if (result.status === 'failed' && handler.onFailed) {
        await handler.onFailed(updated).catch((err) => {
          console.error(`[tasks] onFailed failed for ${task.id}:`, err);
        });
      }
    } catch (err) {
      console.error(`[tasks] poll failed for task ${task.id}:`, err);
      // Touch updated_at so we don't spin on this one
      await updateTask(task.id, { updated_at: new Date().toISOString() } as never);
    }
  }

  return { polled: tasks.length, completed };
}
