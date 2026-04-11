-- 002_connectors.sql
-- Connector credentials + connector instances
-- Apply via Supabase SQL Editor or `supabase db query --linked`

-- Credentials: one row per unique OAuth grant
-- NO RLS policies = anon key has zero access. Backend uses service_role.
CREATE TABLE public.connector_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    account_id TEXT,
    access_token TEXT,
    refresh_token TEXT,
    scopes TEXT[] DEFAULT '{}',
    token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, provider, account_id)
);

ALTER TABLE public.connector_credentials ENABLE ROW LEVEL SECURITY;

-- Connectors: user-facing, one row per connector instance
CREATE TABLE public.connectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    credential_id UUID NOT NULL REFERENCES public.connector_credentials(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    status_message TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own connectors"
    ON public.connectors FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own connectors"
    ON public.connectors FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own connectors"
    ON public.connectors FOR DELETE
    USING (auth.uid() = user_id);

-- Admins can view all connectors
CREATE POLICY "Admins can view all connectors"
    ON public.connectors FOR SELECT
    USING (public.is_admin());

-- Reuse updated_at triggers
CREATE TRIGGER on_connector_credential_updated
    BEFORE UPDATE ON public.connector_credentials
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_connector_updated
    BEFORE UPDATE ON public.connectors
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_connectors_user_id ON public.connectors(user_id);
CREATE INDEX idx_connector_credentials_user_id ON public.connector_credentials(user_id);
