import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';

const app = new Hono();

app.use('*', cors());

app.get('/health', (c) => {
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`A1DE backend running on http://localhost:${info.port}`);
});

export default app;
