import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { listTasks, getTaskForUser } from './db.js';
import { pollRunningTasks } from './runner.js';
import type { TaskStatus } from './types.js';

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

export { tasks };
