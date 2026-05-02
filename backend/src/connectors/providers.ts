export const PROVIDERS = {
  gmail: {
    type: 'email' as const,
    provider: 'gmail' as const,
    authType: 'google' as const,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
  google_calendar: {
    type: 'calendar' as const,
    provider: 'google_calendar' as const,
    authType: 'google' as const,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  },
  google_photos: {
    type: 'photos' as const,
    provider: 'google_photos' as const,
    authType: 'google' as const,
    scopes: ['https://www.googleapis.com/auth/photoslibrary.readonly'],
  },
  plaid: {
    type: 'banking' as const,
    provider: 'plaid' as const,
    authType: 'plaid' as const,
    scopes: ['transactions'],
  },
  whoop: {
    type: 'health' as const,
    provider: 'whoop' as const,
    authType: 'whoop' as const,
    // Whoop OAuth scopes — `offline` lets us refresh without user re-auth.
    // `read:body_measurement` covers weight/height; the rest are the daily
    // metrics we ingest into health_metrics.
    scopes: [
      'offline',
      'read:profile',
      'read:recovery',
      'read:sleep',
      'read:cycles',
      'read:workout',
      'read:body_measurement',
    ],
  },
} as const;

export type ProviderKey = keyof typeof PROVIDERS;

export function getProvider(key: string) {
  return PROVIDERS[key as ProviderKey] ?? null;
}

export function getGoogleProviders() {
  return Object.entries(PROVIDERS).filter(([, p]) => p.authType === 'google');
}
