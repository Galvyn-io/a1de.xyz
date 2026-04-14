-- 005_tasks.sql
-- Unified async task system: any async/scheduled operation is a task
-- Apply via Supabase SQL Editor

CREATE TABLE public.tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- What kind of task and its status
    type                TEXT NOT NULL,          -- e.g. 'golf.search', 'email.sync', 'memory.extract'
    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),

    -- Input + output
    input               JSONB DEFAULT '{}',     -- what the task needs
    output              JSONB,                  -- result
    error               TEXT,                   -- failure reason

    -- External service integration
    external_provider   TEXT,                   -- skyvern, gmail, plaid, anthropic, internal
    external_id         TEXT,                   -- their ID so we can poll/webhook

    -- Progress (optional, for long-running tasks)
    progress_message    TEXT,
    progress_pct        INT CHECK (progress_pct >= 0 AND progress_pct <= 100),

    -- Relationships
    conversation_id     UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    schedule_id         UUID REFERENCES public.schedules(id) ON DELETE SET NULL,
    parent_task_id      UUID REFERENCES public.tasks(id) ON DELETE SET NULL,

    -- Timing
    scheduled_for       TIMESTAMPTZ,            -- for delayed execution
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    retry_count         INT NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tasks"
    ON public.tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own tasks"
    ON public.tasks FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all tasks"
    ON public.tasks FOR SELECT USING (public.is_admin());

CREATE TRIGGER on_task_updated
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_tasks_user_created ON public.tasks(user_id, created_at DESC);
CREATE INDEX idx_tasks_status ON public.tasks(status) WHERE status IN ('pending', 'running');
CREATE INDEX idx_tasks_external_id ON public.tasks(external_provider, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_tasks_conversation ON public.tasks(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX idx_tasks_scheduled ON public.tasks(scheduled_for) WHERE status = 'pending' AND scheduled_for IS NOT NULL;

-- Enable Supabase realtime for live UI updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
