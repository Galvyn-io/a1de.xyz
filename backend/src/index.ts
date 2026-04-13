import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { connectors } from './connectors/router.js';
import { chat } from './chat/router.js';

const app = new Hono();

app.use('*', cors());

app.get('/health', (c) => {
  return c.json({ ok: true });
});

app.route('/connectors', connectors);
app.route('/chat', chat);

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`A1DE backend running on http://localhost:${info.port}`);
});

export default app;
