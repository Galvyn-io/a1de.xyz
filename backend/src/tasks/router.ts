import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { listTasks, getTaskForUser } from './db.js';
import { pollRunningTasks, createTask } from './runner.js';
import type { TaskStatus } from './types.js';
import { listUsersWithCalendarConnector } from '../ingestion/events-db.js';

type AuthEnv = { Variables: { user: User } };

const tasks = new Hono<AuthEnv>();

// List tasks for the authenticated user
tasks.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const statusParam = c.req.query('status');
  const statuses: TaskStatus[] | undefined = statusParam
    ? (statusParam.split(',').filter((s): s is TaskStatus =>
        ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(s),
      ))
    : undefined;
  const limit = Number(c.req.query('limit') ?? '50');

  const result = await listTasks(user.id, { statuses, limit });
  return c.json({ tasks: result });
});

// Get a single task
tasks.get('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id')!;
  const task = await getTaskForUser(id, user.id);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json({ task });
});

// Poll endpoint — called by Cloud Scheduler on a cron to advance running tasks
// Protected with a shared secret in the X-Poll-Secret header
tasks.post('/poll', async (c) => {
  const secret = c.req.header('X-Poll-Secret');
  if (secret !== config.TASK_POLL_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const result = await pollRunningTasks();
  return c.json(result);
});

/**
 * Periodic tick — creates ingestion tasks for users who have active connectors.
 * Called by Cloud Scheduler hourly. Protected by the same poll secret.
 *
 * Idempotent: if there's already a running or recent (<30 min) calendar.sync
 * task for a user's connector, we skip creating another one.
 */
tasks.post('/tick', async (c) => {
  const secret = c.req.header('X-Poll-Secret');
  if (secret !== config.TASK_POLL_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const results = { calendar_sync_created: 0, calendar_sync_skipped: 0 };
  const calendarConnectors = await listUsersWithCalendarConnector();

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

  for (const connector of calendarConnectors) {
    // Skip if there's already a recent sync task for this connector
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recent } = await db
      .from('tasks')
      .select('id')
      .eq('user_id', connector.user_id)
      .eq('type', 'calendar.sync')
      .eq('input->>connectorId', connector.id)
      .gte('created_at', thirtyMinAgo)
      .in('status', ['pending', 'running', 'completed'])
      .limit(1);

    if (recent && recent.length > 0) {
      results.calendar_sync_skipped++;
      continue;
    }

    await createTask({
      userId: connector.user_id,
      type: 'calendar.sync',
      input: { connectorId: connector.id },
    });
    results.calendar_sync_created++;
  }

  return c.json(results);
});

export { tasks };
