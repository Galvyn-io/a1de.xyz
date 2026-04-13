import { createClient } from '@/lib/supabase/server';
import type { UserProfile, Conversation } from '@/lib/supabase/types';
import { ChatInterface } from './chat-interface';

export default async function ChatPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user!.id)
    .single<UserProfile>();

  const { data: conversations } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', user!.id)
    .order('updated_at', { ascending: false })
    .returns<Conversation[]>();

  return (
    <ChatInterface
      initialConversations={conversations ?? []}
      profile={profile!}
    />
  );
}
