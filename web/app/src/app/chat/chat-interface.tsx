'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { UserProfile, Conversation, Message } from '@/lib/supabase/types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

export function ChatInterface({
  initialConversations,
  profile,
  initialConversationId,
  initialMessages,
}: {
  initialConversations: Conversation[];
  profile: UserProfile;
  initialConversationId?: string;
  initialMessages?: Message[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }
  }, [input]);

  async function getToken() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }

  async function loadMessages(conversationId: string) {
    const token = await getToken();
    const res = await fetch(`${BACKEND_URL}/chat/conversations/${conversationId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
    }
  }

  async function selectConversation(id: string) {
    setActiveId(id);
    setSidebarOpen(false);
    await loadMessages(id);
  }

  function startNewChat() {
    setActiveId(null);
    setMessages([]);
    setInput('');
    setSidebarOpen(false);
  }

  async function refreshConversations() {
    const token = await getToken();
    const res = await fetch(`${BACKEND_URL}/chat/conversations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setConversations(data.conversations);
    }
  }

  async function renameConversation(id: string, title: string) {
    if (!title.trim()) return;
    const token = await getToken();
    const res = await fetch(`${BACKEND_URL}/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: title.trim() }),
    });
    if (res.ok) {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: title.trim() } : c)),
      );
    }
    setEditingId(null);
  }

  async function deleteConversation(id: string) {
    if (!confirm('Delete this conversation?')) return;
    const token = await getToken();
    await fetch(`${BACKEND_URL}/chat/conversations/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setStreaming(true);
    setStreamingContent('');
    setError(null);

    // Optimistically add user message
    const optimisticMsg: Message = {
      id: 'temp-' + Date.now(),
      conversation_id: activeId ?? '',
      user_id: profile.id,
      role: 'user',
      content: text,
      tool_calls: null,
      tool_result: null,
      model: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const token = await getToken();

      // 1. POST the user message
      const postRes = await fetch(`${BACKEND_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversation_id: activeId ?? undefined,
          message: text,
        }),
      });

      if (!postRes.ok) {
        throw new Error('Failed to send message');
      }

      const { conversation_id } = await postRes.json();
      if (!activeId) {
        setActiveId(conversation_id);
      }

      // 2. Stream the response
      const streamRes = await fetch(
        `${BACKEND_URL}/chat/stream?conversation_id=${conversation_id}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!streamRes.ok || !streamRes.body) {
        throw new Error('Failed to start stream');
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const event = JSON.parse(payload);

            if (event.delta) {
              fullContent += event.delta;
              setStreamingContent(fullContent);
            }

            if (event.done) {
              // Add the completed assistant message
              setMessages((prev) => [
                ...prev,
                {
                  id: event.message_id,
                  conversation_id: conversation_id,
                  user_id: profile.id,
                  role: 'assistant',
                  content: fullContent,
                  tool_calls: null,
                  tool_result: null,
                  model: null,
                  created_at: new Date().toISOString(),
                },
              ]);
              setStreamingContent('');
            }

            if (event.error) {
              setError(event.error);
            }
          } catch {
            // ignore malformed JSON lines
          }
        }
      }

      await refreshConversations();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
    } finally {
      setStreaming(false);
      setStreamingContent('');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const assistantName = profile.assistant_name ?? 'A1DE';

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } fixed inset-y-0 left-0 z-20 w-72 border-r border-zinc-800 bg-zinc-950 transition-transform md:relative md:translate-x-0`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-zinc-800 p-4">
            <button
              onClick={startNewChat}
              className="w-full rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200"
            >
              New chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group mb-1 flex items-center rounded-lg transition-colors ${
                  activeId === c.id
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                {editingId === c.id ? (
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameConversation(c.id, editTitle);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => renameConversation(c.id, editTitle)}
                    className="flex-1 bg-transparent px-3 py-2 text-sm outline-none"
                  />
                ) : (
                  <>
                    <button
                      onClick={() => selectConversation(c.id)}
                      className="flex-1 truncate px-3 py-2 text-left text-sm"
                    >
                      {c.title ?? 'New conversation'}
                    </button>
                    <div className="flex shrink-0 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(c.id);
                          setEditTitle(c.title ?? '');
                        }}
                        className="px-1.5 py-2 text-xs text-zinc-500 hover:text-zinc-300"
                        title="Rename"
                      >
                        &#9998;
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(c.id);
                        }}
                        className="px-1.5 py-2 text-xs text-zinc-500 hover:text-red-400"
                        title="Delete"
                      >
                        &#10005;
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-800 p-4">
            <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-300">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-zinc-400 hover:text-white md:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          <h1 className="text-sm font-medium">{assistantName}</h1>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 && !streaming && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <h2 className="text-xl font-semibold">
                  Chat with {assistantName}
                </h2>
                <p className="mt-2 text-sm text-zinc-500">
                  Send a message to get started
                </p>
              </div>
            </div>
          )}

          <div className="mx-auto max-w-2xl space-y-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === 'user'
                      ? 'bg-white text-zinc-950'
                      : 'bg-zinc-800 text-zinc-100'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              </div>
            ))}

            {streaming && streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100">
                  <div className="whitespace-pre-wrap">{streamingContent}</div>
                </div>
              </div>
            )}

            {streaming && !streamingContent && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-zinc-800 px-4 py-2.5 text-sm text-zinc-500">
                  Thinking...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-auto flex max-w-2xl items-center justify-between border-t border-red-800 bg-red-950/50 px-4 py-2.5">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => setError(null)} className="text-xs text-red-500 hover:text-red-300">
              Dismiss
            </button>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-zinc-800 px-4 py-4">
          <div className="mx-auto flex max-w-2xl gap-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${assistantName}...`}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm placeholder-zinc-600 outline-none transition-colors focus:border-zinc-600"
              disabled={streaming}
            />
            <button
              onClick={sendMessage}
              disabled={streaming || !input.trim()}
              className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
