// Helper to inject task completion messages into a chat conversation
import { addMessage, touchConversation } from '../chat/db.js';

export async function appendSystemMessageToConversation(
  conversationId: string,
  userId: string,
  content: string,
): Promise<void> {
  // Store as an assistant message so it renders naturally in the chat UI
  await addMessage({
    conversationId,
    userId,
    role: 'assistant',
    content,
  });
  await touchConversation(conversationId);
}
