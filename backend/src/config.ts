import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  OAUTH_CALLBACK_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),
  OAUTH_STATE_SECRET: z.string().min(32),
  ANTHROPIC_API_KEY: z.string().min(1),
  LANGFUSE_PUBLIC_KEY: z.string().min(1),
  LANGFUSE_SECRET_KEY: z.string().min(1),
  LANGFUSE_BASE_URL: z.string().url(),
});

export const config = envSchema.parse(process.env);
