import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { getProvider } from './providers.js';
import { buildAuthUrl, verifyState, exchangeCode } from './google-oauth.js';
import { upsertCredential, createConnector, listConnectors, updateConnector, deleteConnector } from './db.js';

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

    await createConnector({
      userId: state.userId,
      credentialId: credential.id,
      type: state.type,
      provider: state.provider,
      label: state.label || tokens.email,
    });

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

export { connectors };
