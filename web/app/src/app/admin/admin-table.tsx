'use client';

import { Badge } from '@galvyn-io/design/components';
import type { UserProfile } from '@/lib/supabase/types';
import { formatDate } from '@/lib/format';

export function AdminTable({ users }: { users: UserProfile[] }) {
  return (
    <tbody className="divide-y divide-border">
      {users.map((u) => (
        <tr key={u.id} className="transition-colors hover:bg-surface/50">
          <td className="px-4 py-3">{u.email}</td>
          <td className="px-4 py-3">{u.assistant_name ?? '—'}</td>
          <td className="px-4 py-3">
            <Badge variant={u.is_registered ? 'success' : 'default'} size="sm">
              {u.is_registered ? 'Yes' : 'No'}
            </Badge>
          </td>
          <td className="px-4 py-3 text-fg-muted">{formatDate(u.created_at)}</td>
        </tr>
      ))}
      {users.length === 0 && (
        <tr>
          <td colSpan={4} className="px-4 py-8 text-center text-fg-subtle">
            No users yet
          </td>
        </tr>
      )}
    </tbody>
  );
}
