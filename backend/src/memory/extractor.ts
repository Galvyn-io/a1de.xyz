/**
 * Background memory extraction.
 *
 * After each chat turn (user message + assistant response), we send the
 * exchange to Claude Haiku to extract facts the user revealed. This is the
 * "Level 2" pattern from the memory design doc: implicit extraction without
 * requiring the user to say "remember this".
 *
 * Trade-offs:
 * - Haiku is cheap and fast, so running it on every turn has acceptable cost.
 * - We pass the user's existing always-inject memories to avoid duplicates.
 * - Extraction failures are logged but don't surface to the user — a silent
 *   background process should fail silently.
 * - Runs via the tasks system (see tasks/handlers/memory-extract.ts) so it
 *   shows up on /tasks for observability and can be retried on failure.
 *
 * Langfuse traces every extraction with the `memory-extraction` tag so we can
 * review quality and tune the prompt.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { addMemory, getAlwaysInjectMemories } from './db.js';
import { langfuse } from '../telemetry.js';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the conversation below and extract facts about the user that were revealed — either explicitly stated or strongly implied.

Extract ONLY facts that are:
- Personal preferences (food, activities, style, etc.)
- Habits or routines (plays tennis on Saturdays, wakes up early)
- Relationships (friend named Mike, contractor ABC Plumbing)
- Important life facts (works at Anthropic, lives in San Francisco)
- Health information (allergies, fitness level)
- Interests that are clearly demonstrated (asks about golf frequently)

Do NOT extract:
- Temporary or situational things ("user is hungry right now")
- Things the assistant said, only what the user revealed
- Facts already in the existing memories list

For each fact, output a JSON array. Each item:
{
  "content": "clear statement of the fact",
  "category": "preference" | "person" | "project" | "finance" | "health" | "habit",
  "always_inject": true if this is a core preference/trait that should always be in context, false for situational facts,
  "entities": ["entity names mentioned — people, places, companies"]
}

If no new facts were revealed, return an empty array: []

Respond with ONLY the JSON array, no other text.`;

interface ExtractedFact {
  content: string;
  category: string;
  always_inject: boolean;
  entities?: string[];
}

/**
 * Extract and save memories from a single conversation turn.
 *
 * Called from the `memory.extract` task handler after each chat reply.
 * Never throws — errors are logged and swallowed so background extraction
 * never breaks the foreground chat experience.
 */
export async function extractMemoriesFromConversation(params: {
  userId: string;
  conversationId: string;
  userMessage: string;
  assistantResponse: string;
}): Promise<void> {
  const trace = langfuse.trace({
    name: 'memory-extraction',
    userId: params.userId,
    sessionId: params.conversationId,
    tags: ['extraction'],
    input: params.userMessage,
  });

  try {
    // Load existing memories to avoid duplicates
    const existing = await getAlwaysInjectMemories(params.userId);
    const existingContext = existing.length > 0
      ? `\n\nExisting memories (do not extract duplicates):\n${existing.map((m) => `- ${m}`).join('\n')}`
      : '';

    const gen = trace.generation({
      name: 'haiku-extract',
      model: 'claude-haiku-4-5-20251001',
      input: { userMessage: params.userMessage, assistantResponse: params.assistantResponse },
    });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: EXTRACTION_PROMPT + existingContext,
      messages: [
        {
          role: 'user',
          content: `User message: ${params.userMessage}\n\nAssistant response: ${params.assistantResponse}`,
        },
      ],
    });

    gen.end({
      output: response.content,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    });

    // Parse extracted facts
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.type === 'text' ? b.text : '')
      .join('');

    let facts: ExtractedFact[] = [];
    try {
      facts = JSON.parse(text);
    } catch {
      // Haiku sometimes wraps in markdown code blocks
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        facts = JSON.parse(match[0]);
      }
    }

    if (!Array.isArray(facts) || facts.length === 0) {
      trace.update({ output: 'No new facts extracted' });
      return;
    }

    // Save each extracted fact
    for (const fact of facts) {
      if (!fact.content || !fact.category) continue;

      await addMemory({
        userId: params.userId,
        content: fact.content,
        source: 'chat',
        sourceId: params.conversationId,
        category: fact.category,
        alwaysInject: fact.always_inject ?? false,
        entities: fact.entities,
      });
    }

    trace.update({
      output: `Extracted ${facts.length} facts: ${facts.map((f) => f.content).join('; ')}`,
    });
  } catch (err) {
    console.error('Memory extraction error:', err);
    trace.update({
      output: `Error: ${err instanceof Error ? err.message : 'Unknown'}`,
      tags: ['extraction', 'error'],
    });
  } finally {
    await langfuse.flushAsync();
  }
}
