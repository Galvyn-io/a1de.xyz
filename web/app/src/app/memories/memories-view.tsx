'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

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
    const token = await getToken();
    const res = await fetch(`${BACKEND_URL}/memories/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setMemories((prev) => prev.filter((m) => m.id !== id));
      setEntityMemories((prev) => prev.filter((m) => m.id !== id));
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

  // Group memories by category
  const grouped = memories.reduce<Record<string, Memory[]>>((acc, m) => {
    const cat = m.category ?? 'other';
    (acc[cat] ??= []).push(m);
    return acc;
  }, {});

  const sortedCategories = [
    ...CATEGORY_ORDER.filter((c) => grouped[c]),
    ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  // Group entities by type
  const entityGroups = entities.reduce<Record<string, Entity[]>>((acc, e) => {
    (acc[e.type] ??= []).push(e);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">Loading memories...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Memory</h1>
          <p className="mt-1 text-zinc-400">
            Everything your assistant knows about you
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('memories')}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              activeTab === 'memories'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Memories ({memories.length})
          </button>
          <button
            onClick={() => setActiveTab('entities')}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              activeTab === 'entities'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Entities ({entities.length})
          </button>
        </div>
      </div>

      {activeTab === 'memories' && (
        <>
          {memories.length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
              <p className="text-zinc-400">No memories yet.</p>
              <p className="mt-2 text-sm text-zinc-500">
                Chat with your assistant and it will start remembering things about you.
              </p>
              <Link href="/chat" className="mt-4 inline-block text-sm text-white underline">
                Start a conversation
              </Link>
            </div>
          )}

          {sortedCategories.map((category) => (
            <section key={category} className="mb-8">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
              <div className="space-y-2">
                {grouped[category]!.map((m) => (
                  <div
                    key={m.id}
                    className="group flex items-start justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
                  >
                    <div className="flex-1">
                      <p className="text-sm">{m.content}</p>
                      <div className="mt-1 flex items-center gap-3">
                        {m.always_inject && (
                          <span className="rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-400">
                            always active
                          </span>
                        )}
                        <span className="text-xs text-zinc-600">
                          {m.source ?? 'chat'} &middot;{' '}
                          {new Date(m.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteMemory(m.id)}
                      className="ml-3 shrink-0 text-xs text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                      title="Delete memory"
                    >
                      &#10005;
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {activeTab === 'entities' && (
        <div className="flex gap-6">
          {/* Entity list */}
          <div className="w-64 shrink-0">
            {Object.entries(entityGroups).map(([type, ents]) => (
              <div key={type} className="mb-6">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  {type}
                </h3>
                <div className="space-y-1">
                  {ents.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => selectEntity(e.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        selectedEntity === e.id
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                      }`}
                    >
                      {e.name}
                      {e.subtype && (
                        <span className="ml-2 text-xs text-zinc-600">{e.subtype}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {entities.length === 0 && (
              <p className="text-sm text-zinc-500">No entities yet.</p>
            )}
          </div>

          {/* Entity detail */}
          <div className="flex-1">
            {selectedEntity ? (
              <div className="space-y-2">
                <h3 className="mb-3 text-sm font-medium text-zinc-400">
                  Related memories
                </h3>
                {entityMemories.length === 0 && (
                  <p className="text-sm text-zinc-600">No linked memories.</p>
                )}
                {entityMemories.map((m) => (
                  <div
                    key={m.id}
                    className="group flex items-start justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm">{m.content}</p>
                      <span className="text-xs text-zinc-600">
                        {m.source ?? 'chat'} &middot;{' '}
                        {new Date(m.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      onClick={() => deleteMemory(m.id)}
                      className="ml-3 shrink-0 text-xs text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                    >
                      &#10005;
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-zinc-600">
                Select an entity to see related memories
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 flex gap-4">
        <Link href="/chat" className="text-sm text-zinc-400 hover:text-zinc-200">
          Back to chat
        </Link>
        <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-200">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
