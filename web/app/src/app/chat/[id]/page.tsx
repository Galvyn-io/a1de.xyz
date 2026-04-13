import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { UserProfile, Conversation, Message } from '@/lib/supabase/types';
import { ChatInterface } from '../chat-interface';

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user!.id)
    .single<UserProfile>();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .eq('user_id', user!.id)
    .single<Conversation>();

  if (!conversation) {
    redirect('/chat');
  }

  const { data: conversations } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', user!.id)
    .order('updated_at', { ascending: false })
    .returns<Conversation[]>();

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .returns<Message[]>();

  return (
    <ChatInterface
      initialConversations={conversations ?? []}
      profile={profile!}
      initialConversationId={id}
      initialMessages={messages ?? []}
    />
  );
}
