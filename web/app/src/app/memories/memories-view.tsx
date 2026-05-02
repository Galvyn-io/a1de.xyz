'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Badge, FilterToggle } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/toast';
import { AppShell } from '@/components/app-shell';
import { formatDate } from '@/lib/format';

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

interface RelationLeg {
  id: string;
  predicate: string;
  entities: { name: string; type: string } | null;
}

interface RelationsPayload {
  outgoing: Array<RelationLeg & { object_id: string }>;
  incoming: Array<RelationLeg & { subject_id: string }>;
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
  const [entityRelations, setEntityRelations] = useState<RelationsPayload>({ outgoing: [], incoming: [] });
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
    const [memRes, relRes] = await Promise.all([
      fetch(`${BACKEND_URL}/memories/entities/${id}/memories`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${BACKEND_URL}/memories/entities/${id}/relations`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    if (memRes.ok) {
      const data = await memRes.json();
      setEntityMemories(data.memories);
    }
    if (relRes.ok) {
      const data = (await relRes.json()) as RelationsPayload;
      setEntityRelations(data);
    } else {
      setEntityRelations({ outgoing: [], incoming: [] });
    }
  }

  useEffect(() => {
    loadData();
  }, []);

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

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 pt-8 pb-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-medium tracking-tight">Memory</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Everything your assistant knows about you
            </p>
          </div>
          {!loading && (
            <FilterToggle
              value={activeTab}
              onChange={(v) => setActiveTab(v as typeof activeTab)}
              options={[
                { value: 'memories', label: 'Memories', count: memories.length },
                { value: 'entities', label: 'Entities', count: entities.length },
              ]}
            />
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl skeleton" />
            ))}
          </div>
        ) : (
          <div className="fade-in">
            {activeTab === 'memories' && (
              <>
                {memories.length === 0 ? (
                  <div className="rounded-xl border border-border bg-surface p-12 text-center">
                    <div className="mb-3 text-4xl">🪴</div>
                    <p className="font-serif text-xl">Nothing learned yet</p>
                    <p className="mt-2 text-sm text-fg-muted">
                      Chat with your assistant and it will start remembering things about you.
                    </p>
                    <Link
                      href="/chat"
                      className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold accent-on-bg transition-opacity hover:opacity-90"
                    >
                      Start a conversation →
                    </Link>
                  </div>
                ) : (
                  sortedCategories.map((category) => (
                    <section key={category} className="mb-8">
                      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">
                        {CATEGORY_LABELS[category] ?? category}
                      </h2>
                      <div className="space-y-2">
                        {grouped[category]!.map((m) => (
                          <div
                            key={m.id}
                            className="group flex items-start justify-between rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm leading-relaxed">{m.content}</p>
                              <div className="mt-1.5 flex items-center gap-2">
                                {m.always_inject && <Badge variant="success" size="sm">always active</Badge>}
                                <span className="text-xs text-fg-subtle">
                                  {m.source ?? 'chat'} · {formatDate(m.created_at)}
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
                  ))
                )}
              </>
            )}

            {activeTab === 'entities' && (
              <div className="flex flex-col gap-6 md:flex-row">
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

                <div className="flex-1 space-y-6">
                  {selectedEntity ? (
                    <>
                      {(entityRelations.outgoing.length > 0 || entityRelations.incoming.length > 0) && (
                        <div>
                          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">
                            Relations
                          </h3>
                          <ul className="space-y-1">
                            {entityRelations.outgoing.map((r) => (
                              <li key={r.id} className="text-sm">
                                <span className="text-fg-muted">→</span>{' '}
                                <span className="text-fg-subtle italic">{r.predicate}</span>{' '}
                                <span className="font-medium">{r.entities?.name ?? '(unknown)'}</span>
                                {r.entities?.type && (
                                  <span className="ml-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">
                                    {r.entities.type}
                                  </span>
                                )}
                              </li>
                            ))}
                            {entityRelations.incoming.map((r) => (
                              <li key={r.id} className="text-sm">
                                <span className="font-medium">{r.entities?.name ?? '(unknown)'}</span>{' '}
                                <span className="text-fg-subtle italic">{r.predicate}</span>{' '}
                                <span className="text-fg-muted">→</span>
                                {r.entities?.type && (
                                  <span className="ml-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">
                                    {r.entities.type}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div>
                        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">
                          Related memories
                        </h3>
                        {entityMemories.length === 0 && (
                          <p className="text-sm text-fg-subtle">No linked memories.</p>
                        )}
                        <div className="space-y-2">
                          {entityMemories.map((m) => (
                            <div
                              key={m.id}
                              className="group flex items-start justify-between rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong"
                            >
                              <div>
                                <p className="text-sm leading-relaxed">{m.content}</p>
                                <span className="text-xs text-fg-subtle">
                                  {m.source ?? 'chat'} · {formatDate(m.created_at)}
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
                      </div>
                    </>
                  ) : (
                    <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-fg-subtle">
                      Select an entity to see related memories and relations
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
