export interface UserProfile {
  id: string;
  email: string;
  assistant_name: string | null;
  is_registered: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}
