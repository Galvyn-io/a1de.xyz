import type Anthropic from '@anthropic-ai/sdk';
import { hybridSearch } from './search.js';
import { addMemory } from './db.js';

export const MEMORY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_memory',
    description:
      'Search across all knowledge — emails, calendar, conversations, facts, preferences. ' +
      'Use when the user asks about people, projects, preferences, past events, or anything that requires historical context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        category: {
          type: 'string',
          enum: ['person', 'project', 'finance', 'health', 'preference', 'habit', 'all'],
          description: 'Optional category filter to narrow results',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_fact',
    description:
      'Save an important fact or preference to long-term memory. ' +
      'Use when the user tells you something worth remembering permanently — preferences, habits, relationships, important facts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The fact to remember, written as a clear statement',
        },
        category: {
          type: 'string',
          enum: ['preference', 'person', 'project', 'finance', 'health', 'habit'],
          description: 'Category of the fact',
        },
        always_inject: {
          type: 'boolean',
          description: 'True if this should always be in context (core preferences, allergies, key relationships)',
        },
        entities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of people, places, companies, or topics mentioned',
        },
      },
      required: ['content', 'category'],
    },
  },
];

interface SearchMemoryInput {
  query: string;
  category?: string;
  limit?: number;
}

interface SaveFactInput {
  content: string;
  category: string;
  always_inject?: boolean;
  entities?: string[];
}

export async function executeTool(
  name: string,
  input: unknown,
  userId: string,
): Promise<string> {
  try {
    switch (name) {
      case 'search_memory': {
        const params = input as SearchMemoryInput;
        const results = await hybridSearch({
          userId,
          query: params.query,
          category: params.category,
          limit: params.limit,
        });

        if (results.length === 0) {
          return `No memories found for query: "${params.query}"`;
        }

        const lines = results.map(
          (r, i) =>
            `[${i + 1}] ${r.category ?? 'general'}: ${r.content} (source: ${r.source ?? 'unknown'}, score: ${r.score.toFixed(2)})`,
        );
        return `Found ${results.length} memories:\n${lines.join('\n')}`;
      }

      case 'save_fact': {
        const params = input as SaveFactInput;
        await addMemory({
          userId,
          content: params.content,
          source: 'chat',
          category: params.category,
          alwaysInject: params.always_inject ?? false,
          entities: params.entities,
        });
        return `Saved: "${params.content}" (category: ${params.category}${params.always_inject ? ', always injected' : ''})`;
      }

      default:
        return `Error: Unknown tool "${name}"`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return `Error executing ${name}: ${message}`;
  }
}
