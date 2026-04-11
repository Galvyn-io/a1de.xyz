import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// Service role client bypasses RLS — used for credential access
function getServiceClient() {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
}

export interface ConnectorCredentialRow {
  id: string;
  user_id: string;
  provider: string;
  account_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  scopes: string[];
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectorRow {
  id: string;
  user_id: string;
  credential_id: string;
  type: string;
  provider: string;
  label: string;
  status: string;
  status_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function upsertCredential(params: {
  userId: string;
  provider: string;
  accountId: string;
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: Date | null;
}) {
  const db = getServiceClient();

  // Check for existing credential
  const { data: existing } = await db
    .from('connector_credentials')
    .select('*')
    .eq('user_id', params.userId)
    .eq('provider', params.provider)
    .eq('account_id', params.accountId)
    .single<ConnectorCredentialRow>();

  if (existing) {
    // Merge scopes
    const mergedScopes = [...new Set([...existing.scopes, ...params.scopes])];
    const { data, error } = await db
      .from('connector_credentials')
      .update({
        access_token: params.accessToken,
        refresh_token: params.refreshToken ?? existing.refresh_token,
        scopes: mergedScopes,
        token_expires_at: params.expiresAt?.toISOString() ?? null,
      })
      .eq('id', existing.id)
      .select()
      .single<ConnectorCredentialRow>();
    if (error) throw error;
    return data!;
  }

  const { data, error } = await db
    .from('connector_credentials')
    .insert({
      user_id: params.userId,
      provider: params.provider,
      account_id: params.accountId,
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
      scopes: params.scopes,
      token_expires_at: params.expiresAt?.toISOString() ?? null,
    })
    .select()
    .single<ConnectorCredentialRow>();
  if (error) throw error;
  return data!;
}

export async function createConnector(params: {
  userId: string;
  credentialId: string;
  type: string;
  provider: string;
  label: string;
}) {
  const db = getServiceClient();
  const { data, error } = await db
    .from('connectors')
    .insert({
      user_id: params.userId,
      credential_id: params.credentialId,
      type: params.type,
      provider: params.provider,
      label: params.label,
    })
    .select()
    .single<ConnectorRow>();
  if (error) throw error;
  return data!;
}

export async function listConnectors(userId: string) {
  const db = getServiceClient();
  const { data, error } = await db
    .from('connectors')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .returns<ConnectorRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getConnector(connectorId: string, userId: string) {
  const db = getServiceClient();
  const { data, error } = await db
    .from('connectors')
    .select('*')
    .eq('id', connectorId)
    .eq('user_id', userId)
    .single<ConnectorRow>();
  if (error) throw error;
  return data;
}

export async function updateConnector(connectorId: string, userId: string, updates: { label?: string }) {
  const db = getServiceClient();
  const { data, error } = await db
    .from('connectors')
    .update(updates)
    .eq('id', connectorId)
    .eq('user_id', userId)
    .select()
    .single<ConnectorRow>();
  if (error) throw error;
  return data;
}

export async function deleteConnector(connectorId: string, userId: string) {
  const db = getServiceClient();

  // Get the connector first to find its credential
  const connector = await getConnector(connectorId, userId);
  if (!connector) return null;

  // Delete the connector
  const { error } = await db
    .from('connectors')
    .delete()
    .eq('id', connectorId)
    .eq('user_id', userId);
  if (error) throw error;

  // Check if any other connectors use this credential
  const { data: remaining } = await db
    .from('connectors')
    .select('id')
    .eq('credential_id', connector.credential_id)
    .returns<{ id: string }[]>();

  // If no other connectors use the credential, delete it too
  if (!remaining || remaining.length === 0) {
    await db
      .from('connector_credentials')
      .delete()
      .eq('id', connector.credential_id);
  }

  return connector;
}

export async function getCredential(credentialId: string) {
  const db = getServiceClient();
  const { data, error } = await db
    .from('connector_credentials')
    .select('*')
    .eq('id', credentialId)
    .single<ConnectorCredentialRow>();
  if (error) throw error;
  return data;
}

export async function updateCredentialTokens(credentialId: string, tokens: {
  access_token: string;
  token_expires_at: string | null;
  refresh_token?: string;
}) {
  const db = getServiceClient();
  const { error } = await db
    .from('connector_credentials')
    .update(tokens)
    .eq('id', credentialId);
  if (error) throw error;
}
