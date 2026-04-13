import { embed } from './embeddings.js';
import { searchMemories, type SearchResult } from './db.js';

export async function hybridSearch(params: {
  userId: string;
  query: string;
  category?: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const embedding = await embed(params.query);

  return searchMemories({
    userId: params.userId,
    embedding,
    query: params.query,
    category: params.category,
    limit: params.limit ?? 10,
  });
}
