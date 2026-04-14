import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { UserProfile } from '@/lib/supabase/types';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('is_registered')
          .eq('id', user.id)
          .single<Pick<UserProfile, 'is_registered'>>();

        if (profile?.is_registered) {
          return NextResponse.redirect(`${origin}/chat`);
        }
        return NextResponse.redirect(`${origin}/register`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
