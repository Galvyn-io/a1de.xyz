import type { ConnectorProvider } from '@/lib/supabase/types';

export const PROVIDER_META: Record<ConnectorProvider, { label: string; icon: string }> = {
  gmail: { label: 'Gmail', icon: '✉' },
  google_calendar: { label: 'Google Calendar', icon: '📅' },
  google_photos: { label: 'Google Photos', icon: '📷' },
  plaid: { label: 'Bank Account', icon: '🏦' },
  whoop: { label: 'Whoop', icon: '💪' },
  apple_health: { label: 'Apple Health', icon: '❤' },
};

export type AuthFlow = 'google' | 'plaid';

export const CONNECTOR_OPTIONS = [
  { type: 'email' as const, provider: 'gmail' as const, description: 'Read your email', authFlow: 'google' as AuthFlow },
  { type: 'calendar' as const, provider: 'google_calendar' as const, description: 'Access your calendar', authFlow: 'google' as AuthFlow },
  { type: 'photos' as const, provider: 'google_photos' as const, description: 'Access your photos', authFlow: 'google' as AuthFlow },
  { type: 'banking' as const, provider: 'plaid' as const, description: 'Connect your bank accounts', authFlow: 'plaid' as AuthFlow },
];
