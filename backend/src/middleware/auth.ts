import { createClient } from '@supabase/supabase-js';
import type { Context, Next } from 'hono';
import { config } from '../config.js';

export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  c.set('user', user);
  await next();
}
