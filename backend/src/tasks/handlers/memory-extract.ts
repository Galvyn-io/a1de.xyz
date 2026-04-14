// Memory extraction task — runs Claude Haiku on a conversation turn to extract facts
import type { TaskHandler, TaskRow, RunResult } from '../types.js';
import { extractMemoriesFromConversation } from '../../memory/extractor.js';

interface MemoryExtractInput {
  userMessage: string;
  assistantResponse: string;
}

export const memoryExtractHandler: TaskHandler = {
  type: 'memory.extract',
  provider: 'anthropic',

  async run(task: TaskRow): Promise<RunResult> {
    const input = task.input as unknown as MemoryExtractInput;
    if (!task.conversation_id) {
      return { status: 'failed', output: { error: 'missing conversation_id' } };
    }

    await extractMemoriesFromConversation({
      userId: task.user_id,
      conversationId: task.conversation_id,
      userMessage: input.userMessage,
      assistantResponse: input.assistantResponse,
    });

    // Sync task — completes immediately
    return { status: 'completed', output: { ok: true } };
  },
};
