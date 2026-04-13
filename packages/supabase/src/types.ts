export interface UserProfile {
  id: string;
  email: string;
  assistant_name: string | null;
  is_registered: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export type ConnectorType = 'email' | 'calendar' | 'photos' | 'health';
export type ConnectorProvider = 'gmail' | 'google_calendar' | 'google_photos' | 'whoop' | 'apple_health';
export type ConnectorStatus = 'active' | 'error' | 'disconnected';

export interface Connector {
  id: string;
  user_id: string;
  credential_id: string;
  type: ConnectorType;
  provider: ConnectorProvider;
  label: string;
  status: ConnectorStatus;
  status_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}
