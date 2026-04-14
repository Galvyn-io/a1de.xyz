import type { TaskHandler } from './types.js';

const handlers = new Map<string, TaskHandler>();
const providerHandlers = new Map<string, TaskHandler[]>();

export function registerHandler(handler: TaskHandler): void {
  handlers.set(handler.type, handler);
  if (handler.provider) {
    const arr = providerHandlers.get(handler.provider) ?? [];
    arr.push(handler);
    providerHandlers.set(handler.provider, arr);
  }
}

export function getHandler(type: string): TaskHandler | undefined {
  return handlers.get(type);
}

export function getHandlersByProvider(provider: string): TaskHandler[] {
  return providerHandlers.get(provider) ?? [];
}

export function listRegisteredTypes(): string[] {
  return Array.from(handlers.keys());
}
