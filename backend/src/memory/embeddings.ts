import { GoogleAuth } from 'google-auth-library';

const PROJECT_ID = 'a1de-assistant';
const REGION = 'us-west1';
const MODEL = 'gemini-embedding-001';
const DIMENSIONS = 1536;

const ENDPOINT = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL}:predict`;

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

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
