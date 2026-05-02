// Register all task handlers at startup

import { registerHandler } from './registry.js';
import { golfSearchHandler, golfBookHandler } from './handlers/golf.js';
import { memoryExtractHandler } from './handlers/memory-extract.js';
import { calendarSyncHandler } from './handlers/calendar-sync.js';
import { emailSyncHandler } from './handlers/email-sync.js';
import { chatRespondHandler } from './handlers/chat-respond.js';

export function registerAllHandlers(): void {
  registerHandler(golfSearchHandler);
  registerHandler(golfBookHandler);
  registerHandler(memoryExtractHandler);
  registerHandler(calendarSyncHandler);
  registerHandler(emailSyncHandler);
  registerHandler(chatRespondHandler);
}

// Re-exports for convenience
export { createTask, runTask, pollRunningTasks } from './runner.js';
export { getTaskForUser, listTasks, getTask } from './db.js';
export type { TaskRow, TaskHandler } from './types.js';
