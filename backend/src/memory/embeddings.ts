/**
 * Vertex AI Gemini embedding client.
 *
 * Why Vertex AI over OpenAI / AI Studio:
 * - Already on GCP — auth is automatic via the Cloud Run service account's ADC.
 *   No additional API keys to manage in production.
 * - Keeps the embedding model colocated with the backend (us-west1) and with
 *   Supabase (also us-west-1) for low latency.
 *
 * Why 1536 dimensions:
 * - Matches the pgvector column type defined in infra/sql/004_memory.sql.
 *   Changing this requires an ALTER TABLE + full re-embed of existing memories.
 *
 * Upgrade path:
 * - gemini-embedding-2-preview is multimodal (text/image/audio/video).
 *   When we add Photos-based memory retrieval, swap MODEL here.
 */
import { GoogleAuth } from 'google-auth-library';

const PROJECT_ID = 'a1de-assistant';
const REGION = 'us-west1';
const MODEL = 'gemini-embedding-001';
const DIMENSIONS = 1536;

const ENDPOINT = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL}:predict`;

// GoogleAuth picks up ADC from the environment. On Cloud Run this is the
// service account attached to the revision; locally it falls back to
// `gcloud auth application-default login`.
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

/**
 * Generate a dense embedding vector for a piece of text.
 *
 * @param text  The content to embed. Must be non-empty; Vertex AI rejects empty strings.
 * @returns A 1536-dimension float array suitable for pgvector storage.
 * @throws  If Vertex AI returns a non-2xx (invalid auth, quota, empty input).
 */
export async function embed(text: string): Promise<number[]> {
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instances: [{ content: text }],
      // outputDimensionality truncates the native embedding to our DB width.
      // Gemini's native embeddings are 3072-dim; we trade a bit of precision
      // for smaller vectors and faster HNSW index operations.
      parameters: { outputDimensionality: DIMENSIONS },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vertex AI embedding error (${res.status}): ${body}`);
  }

  const data = await res.json() as {
    predictions: Array<{ embeddings: { values: number[] } }>;
  };

  return data.predictions[0]!.embeddings.values;
}
