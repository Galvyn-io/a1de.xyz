'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Kbd } from '@galvyn-io/design/components';

interface Command {
  id: string;
  label: string;
  hint?: string;
  action: () => void;
  group: 'navigate' | 'create' | 'recent';
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Open with ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const commands: Command[] = [
    { id: 'chat-new', label: 'New chat', hint: 'C', group: 'create', action: () => router.push('/chat') },
    { id: 'goto-chat', label: 'Go to chat', group: 'navigate', action: () => router.push('/chat') },
    { id: 'goto-insights', label: 'Go to insights — what\'s new', group: 'navigate', action: () => router.push('/insights') },
    { id: 'goto-tasks', label: 'Go to tasks', group: 'navigate', action: () => router.push('/tasks') },
    { id: 'goto-memory', label: 'Go to memory', group: 'navigate', action: () => router.push('/memories') },
    { id: 'goto-connectors', label: 'Go to connectors', group: 'navigate', action: () => router.push('/connectors') },
    { id: 'goto-dashboard', label: 'Go to dashboard', group: 'navigate', action: () => router.push('/dashboard') },
    { id: 'add-connector', label: 'Add a connector', group: 'create', action: () => router.push('/connectors/add') },
  ];

  const filtered = query.trim()
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  function execute(cmd: Command) {
    cmd.action();
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      e.preventDefault();
      execute(filtered[activeIndex]!);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-md fade-in"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="mt-24 w-full max-w-lg overflow-hidden rounded-2xl glass-strong shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Type a command or search..."
          aria-label="Command palette search"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-fg-subtle"
        />
        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-fg-subtle">No matches</p>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={() => execute(cmd)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                i === activeIndex ? 'bg-surface-hover text-fg' : 'text-fg-muted'
              }`}
            >
              <span>{cmd.label}</span>
              {cmd.hint && <Kbd>{cmd.hint}</Kbd>}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border bg-bg-1 px-3 py-2 text-xs text-fg-subtle">
          <div className="flex items-center gap-3">
            <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span><Kbd>↵</Kbd> select</span>
            <span><Kbd>esc</Kbd> close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
