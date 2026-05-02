import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { connectors } from './connectors/router.js';
import { chat } from './chat/router.js';
import { memories } from './memory/router.js';
import { tasks } from './tasks/router.js';
import { whoopWebhook } from './webhooks/whoop.js';
import { registerAllHandlers } from './tasks/index.js';

// Register task handlers at startup
registerAllHandlers();

const app = new Hono();

app.use('*', cors());

app.get('/health', (c) => {
  return c.json({ ok: true });
});

app.route('/connectors', connectors);
app.route('/chat', chat);
app.route('/memories', memories);
app.route('/tasks', tasks);
app.route('/webhooks/whoop', whoopWebhook);

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`A1DE backend running on http://localhost:${info.port}`);
});

export default app;
