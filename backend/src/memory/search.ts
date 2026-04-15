/**
 * Public hybrid-search API for the memory system.
 *
 * Thin wrapper over `searchMemories` that also handles embedding generation.
 * Callers (tools, tasks, frontend BFF routes) use this instead of reaching
 * into memory/db.ts directly.
 */
import { embed } from './embeddings.js';
import { searchMemories, type SearchResult } from './db.js';

/**
 * Run a hybrid vector + full-text search against the user's memories.
 *
 * @param params.userId     Required — scopes to a single user's memories
 * @param params.query      Natural-language search query (also used for BM25)
 * @param params.category   Optional: narrow to one category (person, project, ...)
 * @param params.limit      Max results to return (default 10)
 */
export async function hybridSearch(params: {
  userId: string;
  query: string;
  category?: string;
  limit?: number;
}): Promise<SearchResult[]> {
  // Embed the query once; the SQL function runs both vector and full-text
  // search in parallel using this single embedding.
  const embedding = await embed(params.query);

  return searchMemories({
    userId: params.userId,
    embedding,
    query: params.query,
    category: params.category,
    limit: params.limit ?? 10,
  });
}
