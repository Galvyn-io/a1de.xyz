'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@galvyn-io/design/components';
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
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const messageCache = useRef<Map<string, Message[]>>(new Map());
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

  // Seed cache with initial messages if provided
  useEffect(() => {
    if (initialConversationId && initialMessages?.length) {
      messageCache.current.set(initialConversationId, initialMessages);
    }
  }, [initialConversationId, initialMessages]);

  // Subscribe to realtime new messages on the active conversation
  // Used to pick up task-generated messages (tee time results, booking confirmations)
  // that appear without the user having to do anything
  useEffect(() => {
    if (!activeId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`conversation:${activeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            // Skip if we already have this message (streaming flow inserts too)
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            const updated = [...prev, newMsg];
            messageCache.current.set(activeId, updated);
            return updated;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeId]);

  async function loadMessages(conversationId: string) {
    // Return cached messages instantly if available
    const cached = messageCache.current.get(conversationId);
    if (cached) {
      setMessages(cached);
      return;
    }

    const token = await getToken();
    const res = await fetch(`${BACKEND_URL}/chat/conversations/${conversationId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      messageCache.current.set(conversationId, data.messages);
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
    messageCache.current.delete(id);
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

            if (event.tool_call) {
              const toolName = event.tool_call.name;
              const label = toolName === 'search_memory' ? 'Searching memory...'
                : toolName === 'save_fact' ? 'Saving to memory...'
                : toolName === 'search_golf_courses' ? 'Searching golf courses...'
                : toolName === 'web_search' ? 'Searching the web...'
                : toolName === 'check_tee_times_at_course' ? 'Starting tee time check...'
                : toolName === 'check_task_status' ? 'Checking task status...'
                : toolName === 'book_tee_time' ? 'Starting booking...'
                : `Running ${toolName}...`;
              setToolStatus(label);
            }

            if (event.delta) {
              setToolStatus(null);
              fullContent += event.delta;
              setStreamingContent(fullContent);
            }

            if (event.done) {
              const assistantMsg: Message = {
                id: event.message_id,
                conversation_id: conversation_id,
                user_id: profile.id,
                role: 'assistant',
                content: fullContent,
                tool_calls: null,
                tool_result: null,
                model: null,
                created_at: new Date().toISOString(),
              };
              setMessages((prev) => {
                const updated = [...prev, assistantMsg];
                messageCache.current.set(conversation_id, updated);
                return updated;
              });
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
      setToolStatus(null);
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
    <div className="flex h-screen bg-bg">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } fixed inset-y-0 left-0 z-20 w-72 border-r border-border bg-bg-1 transition-transform md:relative md:translate-x-0`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-border p-3">
            <Button onClick={startNewChat} variant="accent" size="md" className="w-full">
              + New chat
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group mb-0.5 flex items-center rounded-md transition-colors ${
                  activeId === c.id
                    ? 'bg-surface-2 text-fg'
                    : 'text-fg-muted hover:bg-surface hover:text-fg'
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
                        onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditTitle(c.title ?? ''); }}
                        className="px-1.5 py-2 text-xs text-fg-subtle hover:text-fg"
                        title="Rename"
                      >
                        ✎
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                        className="px-1.5 py-2 text-xs text-fg-subtle hover:text-error"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-border p-4 space-y-1.5">
            <Link href="/memories" className="block text-xs text-fg-subtle hover:text-fg">Memory</Link>
            <Link href="/tasks" className="block text-xs text-fg-subtle hover:text-fg">Tasks</Link>
            <Link href="/connectors" className="block text-xs text-fg-subtle hover:text-fg">Connectors</Link>
            <Link href="/dashboard" className="block text-xs text-fg-subtle hover:text-fg">Dashboard</Link>
            <p className="pt-1 text-[10px] text-fg-subtle">
              Press <kbd className="rounded border border-border px-1 py-0.5 font-mono">⌘K</kbd> to navigate
            </p>
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
      <div className="flex flex-1 flex-col bg-bg">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-fg-muted hover:text-fg md:hidden"
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
              <div className="max-w-md text-center">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Chat with {assistantName}
                </h2>
                <p className="mt-2 text-sm text-fg-muted">
                  Ask anything. I&apos;ll remember what matters.
                </p>
                <div className="mt-6 grid grid-cols-1 gap-2 text-left text-xs">
                  {[
                    'Find tee times near 98011 this Saturday',
                    'Remember that I prefer spicy tuna rolls',
                    "What's on my calendar tomorrow?",
                  ].map((p) => (
                    <button
                      key={p}
                      onClick={() => setInput(p)}
                      className="rounded-md border border-border bg-surface px-3 py-2 text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
                    >
                      {p}
                    </button>
                  ))}
                </div>
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
                      ? 'bg-accent text-white'
                      : 'bg-surface text-fg border border-border'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              </div>
            ))}

            {streaming && streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl bg-surface text-fg border border-border px-4 py-2.5 text-sm">
                  <div className="whitespace-pre-wrap cursor-blink">{streamingContent}</div>
                </div>
              </div>
            )}

            {streaming && !streamingContent && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-surface border border-border px-4 py-2.5 text-sm text-fg-muted">
                  {toolStatus ? (
                    <span>{toolStatus}</span>
                  ) : (
                    <span className="thinking-dots">
                      <span>.</span><span>.</span><span>.</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-auto flex max-w-2xl items-center justify-between border-t border-error/50 bg-error/10 px-4 py-2.5">
            <p className="text-sm text-error">{error}</p>
            <button onClick={() => setError(null)} className="text-xs text-error hover:opacity-70">
              Dismiss
            </button>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border px-4 py-4">
          <div className="mx-auto flex max-w-2xl gap-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${assistantName}...`}
              rows={1}
              className="flex-1 resize-none rounded-lg border border-border bg-surface px-4 py-3 text-sm text-fg placeholder-fg-subtle outline-none transition-colors focus:border-accent"
              disabled={streaming}
            />
            <Button
              onClick={sendMessage}
              disabled={streaming || !input.trim()}
              variant="accent"
              size="md"
            >
              Send
            </Button>
          </div>
          <p className="mx-auto mt-1.5 max-w-2xl text-[10px] text-fg-subtle">
            Press <kbd className="rounded border border-border px-1 py-0.5 font-mono">Enter</kbd> to send,{' '}
            <kbd className="rounded border border-border px-1 py-0.5 font-mono">Shift+Enter</kbd> for new line
          </p>
        </div>
      </div>
    </div>
  );
}
