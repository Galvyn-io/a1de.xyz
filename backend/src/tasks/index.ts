// Register all task handlers at startup

import { registerHandler } from './registry.js';
import { golfSearchHandler, golfBookHandler } from './handlers/golf.js';
import { memoryExtractHandler } from './handlers/memory-extract.js';
import { calendarSyncHandler } from './handlers/calendar-sync.js';

export function registerAllHandlers(): void {
  registerHandler(golfSearchHandler);
  registerHandler(golfBookHandler);
  registerHandler(memoryExtractHandler);
  registerHandler(calendarSyncHandler);
}

// Re-exports for convenience
export { createTask, runTask, pollRunningTasks } from './runner.js';
export { getTaskForUser, listTasks, getTask } from './db.js';
export type { TaskRow, TaskHandler } from './types.js';
