import { google } from 'googleapis';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import { getCredential, updateCredentialTokens } from './db.js';

const secret = new TextEncoder().encode(config.OAUTH_STATE_SECRET);

function getOAuth2Client() {
  return new google.auth.OAuth2(
    config.GOOGLE_OAUTH_CLIENT_ID,
    config.GOOGLE_OAUTH_CLIENT_SECRET,
    config.OAUTH_CALLBACK_URL,
  );
}

export interface OAuthState {
  userId: string;
  type: string;
  provider: string;
  label: string;
}

export async function buildAuthUrl(params: {
  userId: string;
  type: string;
  provider: string;
  label: string;
  scopes: string[];
}) {
  const oauth2Client = getOAuth2Client();

  const state = await new SignJWT({
    userId: params.userId,
    type: params.type,
    provider: params.provider,
    label: params.label,
  } satisfies OAuthState)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(secret);

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      ...params.scopes,
    ],
    include_granted_scopes: true,
    state,
  });
}

export async function verifyState(state: string): Promise<OAuthState> {
  const { payload } = await jwtVerify(state, secret);
  return payload as unknown as OAuthState;
}

export async function exchangeCode(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  // Get user's Google email from id_token
  const ticket = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token!,
    audience: config.GOOGLE_OAUTH_CLIENT_ID,
  });
  const payload = ticket.getPayload()!;
  const email = payload.email!;

  return {
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    email,
  };
}

export async function getValidAccessToken(credentialId: string): Promise<string> {
  const credential = await getCredential(credentialId);
  if (!credential) throw new Error('Credential not found');

  const now = new Date();
  const expiresAt = credential.token_expires_at ? new Date(credential.token_expires_at) : null;
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  // Return current token if still valid
  if (credential.access_token && expiresAt && expiresAt.getTime() - now.getTime() > bufferMs) {
    return credential.access_token;
  }

  // Refresh the token
  if (!credential.refresh_token) {
    throw new Error('No refresh token available');
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: credential.refresh_token });
  const { credentials } = await oauth2Client.refreshAccessToken();

  await updateCredentialTokens(credentialId, {
    access_token: credentials.access_token!,
    token_expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
    ...(credentials.refresh_token ? { refresh_token: credentials.refresh_token } : {}),
  });

  return credentials.access_token!;
}
