import type { ConnectorProvider } from '@/lib/supabase/types';

export const PROVIDER_META: Record<ConnectorProvider, { label: string; icon: string }> = {
  gmail: { label: 'Gmail', icon: '✉' },
  google_calendar: { label: 'Google Calendar', icon: '📅' },
  google_photos: { label: 'Google Photos', icon: '📷' },
  whoop: { label: 'Whoop', icon: '💪' },
  apple_health: { label: 'Apple Health', icon: '❤' },
};

export const CONNECTOR_OPTIONS = [
  { type: 'email' as const, provider: 'gmail' as const, description: 'Read your email' },
  { type: 'calendar' as const, provider: 'google_calendar' as const, description: 'Access your calendar' },
  { type: 'photos' as const, provider: 'google_photos' as const, description: 'Access your photos' },
];
