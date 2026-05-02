/**
 * Whoop OAuth2 client.
 *
 * Mirrors the shape of `google-oauth.ts` so the connector router can
 * dispatch to either provider with the same code path. Whoop uses a
 * standard authorization-code flow with refresh tokens (we ask for the
 * `offline` scope so we get one back).
 *
 * Reference: https://developer.whoop.com/api/
 */
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import { getCredential, updateCredentialTokens } from './db.js';

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_PROFILE_URL = 'https://api.prod.whoop.com/developer/v2/user/profile/basic';

const stateSecret = new TextEncoder().encode(config.OAUTH_STATE_SECRET);

export interface WhoopOAuthState {
  userId: string;
  type: string;
  provider: string;
  label: string;
}

function ensureConfigured(): { clientId: string; clientSecret: string } {
  if (!config.WHOOP_CLIENT_ID || !config.WHOOP_CLIENT_SECRET) {
    throw new Error(
      'Whoop is not configured: set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET environment variables.',
    );
  }
  return { clientId: config.WHOOP_CLIENT_ID, clientSecret: config.WHOOP_CLIENT_SECRET };
}

/**
 * Derive the Whoop callback URL from the existing OAUTH_CALLBACK_URL
 * (which points at the Google callback). This avoids adding a new
 * env var just for Whoop. The backend host is the same; only the path
 * differs.
 */
function whoopRedirectUri(): string {
  const u = new URL(config.OAUTH_CALLBACK_URL);
  return `${u.origin}/connectors/whoop/callback`;
}

/**
 * Build the OAuth authorize URL. The `state` is a short-lived signed JWT
 * carrying user identity + the connector params we need on the callback.
 */
export async function buildWhoopAuthUrl(params: {
  userId: string;
  type: string;
  provider: string;
  label: string;
  scopes: string[];
}): Promise<string> {
  const { clientId } = ensureConfigured();

  const state = await new SignJWT({
    userId: params.userId,
    type: params.type,
    provider: params.provider,
    label: params.label,
  } satisfies WhoopOAuthState)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(stateSecret);

  const url = new URL(WHOOP_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', whoopRedirectUri());
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export async function verifyWhoopState(state: string): Promise<WhoopOAuthState> {
  const { payload } = await jwtVerify(state, stateSecret);
  return payload as unknown as WhoopOAuthState;
}

interface WhoopTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

interface WhoopProfile {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

/**
 * Exchange the OAuth code for tokens, then fetch the user's profile so we
 * can label the credential with their email (matches Google's pattern).
 */
export async function exchangeWhoopCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  email: string;
  whoopUserId: string;
}> {
  const { clientId, clientSecret } = ensureConfigured();

  const redirectUri = whoopRedirectUri();

  const tokenRes = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Whoop token exchange failed (${tokenRes.status}): ${body.slice(0, 200)}`);
  }
  const tokens = (await tokenRes.json()) as WhoopTokenResponse;

  const profileRes = await fetch(WHOOP_PROFILE_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) {
    const body = await profileRes.text();
    throw new Error(`Whoop profile fetch failed (${profileRes.status}): ${body.slice(0, 200)}`);
  }
  const profile = (await profileRes.json()) as WhoopProfile;

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    email: profile.email,
    whoopUserId: String(profile.user_id),
  };
}

/**
 * Get a non-expired access token for a stored credential, refreshing if
 * the current one is within 5 minutes of expiry. Mirrors the Google
 * pattern in google-oauth.ts so callers can use either uniformly.
 */
export async function getValidWhoopAccessToken(credentialId: string): Promise<string> {
  const { clientId, clientSecret } = ensureConfigured();

  const credential = await getCredential(credentialId);
  if (!credential) throw new Error('Credential not found');

  const now = Date.now();
  const expiresAt = credential.token_expires_at ? new Date(credential.token_expires_at).getTime() : 0;
  const bufferMs = 5 * 60 * 1000;

  if (credential.access_token && expiresAt - now > bufferMs) {
    return credential.access_token;
  }
  if (!credential.refresh_token) {
    throw new Error('No Whoop refresh token available');
  }

  const refreshRes = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      // Whoop requires `scope` on refresh per their docs.
      scope: 'offline',
    }),
  });
  if (!refreshRes.ok) {
    const body = await refreshRes.text();
    throw new Error(`Whoop refresh failed (${refreshRes.status}): ${body.slice(0, 200)}`);
  }
  const refreshed = (await refreshRes.json()) as WhoopTokenResponse;

  await updateCredentialTokens(credentialId, {
    access_token: refreshed.access_token,
    token_expires_at: refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
      : null,
    ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
  });

  return refreshed.access_token;
}
