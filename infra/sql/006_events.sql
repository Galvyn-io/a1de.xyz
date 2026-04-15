-- 006_events.sql
-- Events table for structured calendar/email/etc. events
-- Apply via Supabase SQL Editor

CREATE TABLE public.events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    connector_id        UUID REFERENCES public.connectors(id) ON DELETE SET NULL,

    -- Source provenance
    source              TEXT NOT NULL,   -- 'google_calendar', 'gmail_travel', ...
    source_id           TEXT NOT NULL,   -- provider's stable id

    -- Content
    title               TEXT,
    description         TEXT,
    location            TEXT,
    attendees           JSONB DEFAULT '[]',
    organizer           TEXT,

    -- Temporal
    start_at            TIMESTAMPTZ,
    end_at              TIMESTAMPTZ,
    all_day             BOOLEAN DEFAULT false,
    recurring_event_id  TEXT,    -- same for all instances of a recurring series

    -- Status
    status              TEXT DEFAULT 'confirmed',   -- confirmed | tentative | cancelled
    deleted_at          TIMESTAMPTZ,

    -- Raw payload kept for later reprocessing / debugging
    raw                 JSONB,

    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),

    -- Upsert target: same (user, source, source_id) always refers to the same event
    UNIQUE (user_id, source, source_id)
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own events"
    ON public.events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all events"
    ON public.events FOR SELECT USING (public.is_admin());

CREATE TRIGGER on_event_updated
    BEFORE UPDATE ON public.events
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Fast: "events for this user in a date range"
CREATE INDEX idx_events_user_start ON public.events(user_id, start_at DESC)
    WHERE deleted_at IS NULL;

-- Lookup by source_id during sync
CREATE INDEX idx_events_source ON public.events(user_id, source, source_id);

-- Recurring series lookup
CREATE INDEX idx_events_recurring ON public.events(user_id, recurring_event_id)
    WHERE recurring_event_id IS NOT NULL;

-- Per-connector incremental sync cursor. Stored on the connectors table so the
-- tasks system doesn't need its own state — one cursor per connector instance.
ALTER TABLE public.connectors ADD COLUMN IF NOT EXISTS sync_cursor TEXT;
