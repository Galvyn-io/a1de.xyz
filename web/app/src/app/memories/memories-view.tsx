'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Badge, FilterToggle } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/toast';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

interface Memory {
  id: string;
  content: string;
  source: string | null;
  category: string | null;
  always_inject: boolean;
  created_at: string;
}

interface Entity {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  preference: 'Preferences',
  person: 'People',
  project: 'Projects',
  finance: 'Finance',
  health: 'Health',
  habit: 'Habits',
};

const CATEGORY_ORDER = ['preference', 'person', 'project', 'finance', 'health', 'habit'];

export function MemoriesView() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [activeTab, setActiveTab] = useState<'memories' | 'entities'>('memories');
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [entityMemories, setEntityMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  async function getToken() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }

  async function loadData() {
    setLoading(true);
    const token = await getToken();

    const [memRes, entRes] = await Promise.all([
      fetch(`${BACKEND_URL}/memories`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${BACKEND_URL}/memories/entities`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    if (memRes.ok) {
      const data = await memRes.json();
      setMemories(data.memories);
    }
    if (entRes.ok) {
      const data = await entRes.json();
      setEntities(data.entities);
    }
    setLoading(false);
  }

  async function deleteMemory(id: string) {
    try {
      const token = await getToken();
      const res = await fetch(`${BACKEND_URL}/memories/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      setEntityMemories((prev) => prev.filter((m) => m.id !== id));
      toast('Memory removed', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast(`Failed to remove memory: ${msg}`, 'error');
    }
  }

  async function selectEntity(id: string) {
    setSelectedEntity(id);
    const token = await getToken();
    const res = await fetch(`${BACKEND_URL}/memories/entities/${id}/memories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setEntityMemories(data.memories);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Memoize grouping — avoids recomputing on every render
  const grouped = useMemo(
    () =>
      memories.reduce<Record<string, Memory[]>>((acc, m) => {
        const cat = m.category ?? 'other';
        (acc[cat] ??= []).push(m);
        return acc;
      }, {}),
    [memories],
  );

  const sortedCategories = useMemo(
    () => [
      ...CATEGORY_ORDER.filter((c) => grouped[c]),
      ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
    ],
    [grouped],
  );

  const entityGroups = useMemo(
    () =>
      entities.reduce<Record<string, Entity[]>>((acc, e) => {
        (acc[e.type] ??= []).push(e);
        return acc;
      }, {}),
    [entities],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-fg-muted">Loading memories...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Memory</h1>
          <p className="mt-1 text-fg-muted">
            Everything your assistant knows about you
          </p>
        </div>
        <FilterToggle
          value={activeTab}
          onChange={(v) => setActiveTab(v as typeof activeTab)}
          options={[
            { value: 'memories', label: 'Memories', count: memories.length },
            { value: 'entities', label: 'Entities', count: entities.length },
          ]}
        />
      </div>

      {activeTab === 'memories' && (
        <>
          {memories.length === 0 && (
            <div className="rounded-xl border border-border bg-surface p-12 text-center">
              <p className="text-fg-muted">No memories yet.</p>
              <p className="mt-2 text-sm text-fg-subtle">
                Chat with your assistant and it will start remembering things about you.
              </p>
              <Link href="/chat" className="mt-4 inline-block text-sm text-accent-text hover:underline">
                Start a conversation →
              </Link>
            </div>
          )}

          {sortedCategories.map((category) => (
            <section key={category} className="mb-8">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
              <div className="space-y-2">
                {grouped[category]!.map((m) => (
                  <div
                    key={m.id}
                    className="group flex items-start justify-between rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{m.content}</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        {m.always_inject && <Badge variant="success" size="sm">always active</Badge>}
                        <span className="text-xs text-fg-subtle">
                          {m.source ?? 'chat'} · {new Date(m.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteMemory(m.id)}
                      className="ml-3 shrink-0 text-xs text-fg-subtle opacity-0 transition-opacity hover:text-error focus:outline focus:outline-1 focus:outline-error focus:opacity-100 group-hover:opacity-100"
                      aria-label="Delete this memory"
                      title="Delete memory"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {activeTab === 'entities' && (
        <div className="flex flex-col gap-6 md:flex-row">
          {/* Entity list */}
          <div className="md:w-64 md:shrink-0">
            {Object.entries(entityGroups).map(([type, ents]) => (
              <div key={type} className="mb-6">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
                  {type}
                </h3>
                <div className="space-y-0.5">
                  {ents.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => selectEntity(e.id)}
                      className={`w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                        selectedEntity === e.id
                          ? 'bg-surface-2 text-fg'
                          : 'text-fg-muted hover:bg-surface hover:text-fg'
                      }`}
                    >
                      {e.name}
                      {e.subtype && (
                        <span className="ml-2 text-xs text-fg-subtle">{e.subtype}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {entities.length === 0 && (
              <p className="text-sm text-fg-subtle">No entities yet.</p>
            )}
          </div>

          {/* Entity detail */}
          <div className="flex-1">
            {selectedEntity ? (
              <div className="space-y-2">
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">
                  Related memories
                </h3>
                {entityMemories.length === 0 && (
                  <p className="text-sm text-fg-subtle">No linked memories.</p>
                )}
                {entityMemories.map((m) => (
                  <div
                    key={m.id}
                    className="group flex items-start justify-between rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong"
                  >
                    <div>
                      <p className="text-sm">{m.content}</p>
                      <span className="text-xs text-fg-subtle">
                        {m.source ?? 'chat'} · {new Date(m.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      onClick={() => deleteMemory(m.id)}
                      className="ml-3 shrink-0 text-xs text-fg-subtle opacity-0 transition-opacity hover:text-error focus:outline focus:outline-1 focus:outline-error focus:opacity-100 group-hover:opacity-100"
                      aria-label="Delete this memory"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-fg-subtle">
                Select an entity to see related memories
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 flex gap-4">
        <Link href="/chat" className="text-sm text-fg-muted hover:text-fg">← Back to chat</Link>
        <Link href="/dashboard" className="text-sm text-fg-muted hover:text-fg">Dashboard</Link>
      </div>
    </div>
  );
}
