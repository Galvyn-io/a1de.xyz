import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { getProvider } from './providers.js';
import { buildAuthUrl, verifyState, exchangeCode } from './google-oauth.js';
import { upsertCredential, createConnector, listConnectors, updateConnector, deleteConnector } from './db.js';
import { createLinkToken, exchangePublicToken } from './plaid.js';

type AuthEnv = { Variables: { user: User } };

const connectors = new Hono<AuthEnv>();

// List user's connectors
connectors.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const data = await listConnectors(user.id);
  return c.json({ connectors: data });
});

// Start Google OAuth flow
connectors.post('/google/auth', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ type: string; provider: string; label?: string }>();

  const providerConfig = getProvider(body.provider);
  if (!providerConfig || providerConfig.authType !== 'google') {
    return c.json({ error: 'Unsupported provider' }, 400);
  }

  const url = await buildAuthUrl({
    userId: user.id,
    type: providerConfig.type,
    provider: providerConfig.provider,
    label: body.label ?? '',
    scopes: [...providerConfig.scopes],
  });

  return c.json({ url });
});

// Google OAuth callback — no auth middleware, uses state JWT
connectors.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const stateParam = c.req.query('state');
  const error = c.req.query('error');

  if (error || !code || !stateParam) {
    return c.redirect(`${config.FRONTEND_URL}/connectors?error=${error ?? 'missing_code'}`);
  }

  try {
    const state = await verifyState(stateParam);
    const tokens = await exchangeCode(code);

    const credential = await upsertCredential({
      userId: state.userId,
      provider: 'google',
      accountId: tokens.email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scopes,
      expiresAt: tokens.expiresAt,
    });

    const connector = await createConnector({
      userId: state.userId,
      credentialId: credential.id,
      type: state.type,
      provider: state.provider,
      label: state.label || tokens.email,
    });

    // Kick off an immediate backfill so the Now panel / /tasks shows activity
    // right away. Only for providers with a known ingestion pipeline.
    const backfillTaskType =
      state.provider === 'google_calendar' ? 'calendar.sync' :
      state.provider === 'gmail' ? 'email.sync' :
      null;
    if (backfillTaskType) {
      const { createTask } = await import('../tasks/index.js');
      await createTask({
        userId: state.userId,
        type: backfillTaskType,
        input: { connectorId: connector.id, backfill: true },
      });
    }

    return c.redirect(`${config.FRONTEND_URL}/connectors?success=true`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return c.redirect(`${config.FRONTEND_URL}/connectors?error=callback_failed`);
  }
});

// Update connector (label)
connectors.patch('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id')!;
  const body = await c.req.json<{ label: string }>();

  const updated = await updateConnector(id, user.id, { label: body.label });
  if (!updated) {
    return c.json({ error: 'Connector not found' }, 404);
  }
  return c.json({ connector: updated });
});

// Which connector providers have a matching sync task type
const REFRESH_TASK_TYPES: Record<string, string> = {
  google_calendar: 'calendar.sync',
  gmail: 'email.sync',
};

// Force a full refresh / backfill of a connector on demand
connectors.post('/:id/refresh', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id')!;

  const { getConnector } = await import('./db.js');
  const connector = await getConnector(id, user.id);
  if (!connector) return c.json({ error: 'Connector not found' }, 404);

  const taskType = REFRESH_TASK_TYPES[connector.provider];
  if (!taskType) {
    return c.json({ error: `No refresh handler for provider: ${connector.provider}` }, 400);
  }

  const { createTask } = await import('../tasks/index.js');
  const task = await createTask({
    userId: user.id,
    type: taskType,
    input: { connectorId: id, backfill: true },
  });

  return c.json({ task_id: task.id, type: taskType });
});

// Disconnect connector
connectors.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id')!;

  const deleted = await deleteConnector(id, user.id);
  if (!deleted) {
    return c.json({ error: 'Connector not found' }, 404);
  }
  return c.json({ ok: true });
});

// Plaid: Create a link token for Plaid Link widget
connectors.post('/plaid/link-token', requireAuth, async (c) => {
  const user = c.get('user');
  const linkToken = await createLinkToken(user.id);
  return c.json({ link_token: linkToken });
});

// Plaid: Exchange public token after user connects a bank
connectors.post('/plaid/exchange', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ public_token: string; label?: string }>();

  if (!body.public_token) {
    return c.json({ error: 'public_token is required' }, 400);
  }

  try {
    const { accessToken, itemId } = await exchangePublicToken(body.public_token);

    // Store as a connector credential
    const credential = await upsertCredential({
      userId: user.id,
      provider: 'plaid',
      accountId: itemId,
      accessToken,
      refreshToken: null,
      scopes: ['transactions'],
      expiresAt: null, // Plaid tokens don't expire
    });

    // Create the connector
    await createConnector({
      userId: user.id,
      credentialId: credential.id,
      type: 'banking',
      provider: 'plaid',
      label: body.label || 'Bank Account',
    });

    return c.json({ ok: true });
  } catch (err) {
    console.error('Plaid exchange error:', err);
    return c.json({ error: 'Failed to connect bank account' }, 500);
  }
});

export { connectors };
