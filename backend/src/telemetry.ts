import Langfuse from 'langfuse';
import { config } from './config.js';

export const langfuse = new Langfuse({
  publicKey: config.LANGFUSE_PUBLIC_KEY,
  secretKey: config.LANGFUSE_SECRET_KEY,
  baseUrl: config.LANGFUSE_BASE_URL,
});
