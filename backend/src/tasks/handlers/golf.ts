// Task handlers for golf: tee time search and booking

import type { TaskHandler, TaskRow, RunResult, PollResult } from '../types.js';
import { searchTeeTimesOnSite, createBookingTask, getTaskStatus as skyvernGetTask } from '../../golf/skyvern.js';
import { addMemory } from '../../memory/db.js';
import { appendSystemMessageToConversation } from '../chat-notifier.js';

interface GolfSearchInput {
  course_website: string;
  course_name: string;
  date: string;
  players?: number;
}

interface GolfBookInput {
  course_website: string;
  course_name: string;
  date: string;
  time: string;
  players: number;
}

function mapSkyvernStatus(skyvernStatus: string): 'pending' | 'running' | 'completed' | 'failed' {
  if (skyvernStatus === 'completed') return 'completed';
  if (skyvernStatus === 'failed' || skyvernStatus === 'terminated') return 'failed';
  return 'running';
}

export const golfSearchHandler: TaskHandler = {
  type: 'golf.search',
  provider: 'skyvern',

  async run(task: TaskRow): Promise<RunResult> {
    const input = task.input as unknown as GolfSearchInput;
    const skyvernTask = await searchTeeTimesOnSite({
      url: input.course_website,
      courseName: input.course_name,
      date: input.date,
      players: input.players,
    });

    return {
      external_provider: 'skyvern',
      external_id: skyvernTask.task_id,
      progress_message: 'Navigating booking site...',
    };
  },

  async poll(task: TaskRow): Promise<PollResult> {
    if (!task.external_id) {
      return { status: 'failed', error: 'No external_id to poll' };
    }
    const skyvern = await skyvernGetTask(task.external_id);
    const status = mapSkyvernStatus(skyvern.status);

    if (status === 'completed') {
      return {
        status: 'completed',
        output: (skyvern.extracted_information as Record<string, unknown>) ?? {},
      };
    }
    if (status === 'failed') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reason = (skyvern as any).failure_reason ?? 'Task failed';
      return { status: 'failed', error: reason };
    }
    return { status: 'running' };
  },

  async onComplete(task: TaskRow): Promise<void> {
    const input = task.input as unknown as GolfSearchInput;

    // Save the booking URL to memory — it worked
    try {
      await addMemory({
        userId: task.user_id,
        content: `${input.course_name} booking URL: ${input.course_website}`,
        source: 'golf_verified',
        category: 'project',
        alwaysInject: false,
        entities: [input.course_name],
      });
    } catch (e) {
      console.error('[golf.search.onComplete] failed to save URL:', e);
    }

    // Notify the chat if this task came from a conversation
    if (task.conversation_id) {
      const output = task.output as { tee_times?: Array<{ time: string; price: number; rate_type?: string; players_available?: number }> } | null;
      const teeTimes = output?.tee_times ?? [];

      let message: string;
      if (teeTimes.length === 0) {
        message = `Tee time check at ${input.course_name} on ${input.date} finished, but no times came back. The site may require login or may have no availability.`;
      } else {
        const lines = teeTimes.slice(0, 15).map((t) => {
          const players = t.players_available ? ` (${t.players_available} spots)` : '';
          const rate = t.rate_type && t.rate_type !== 'standard' ? ` — ${t.rate_type}` : '';
          return `  • ${t.time} — $${t.price}${rate}${players}`;
        });
        message = `✓ Tee times at ${input.course_name} for ${input.date}:\n\n${lines.join('\n')}${teeTimes.length > 15 ? `\n\n(${teeTimes.length - 15} more times available)` : ''}\n\nBooking URL saved to memory for next time.`;
      }

      await appendSystemMessageToConversation(task.conversation_id, task.user_id, message);
    }
  },

  async onFailed(task: TaskRow): Promise<void> {
    if (!task.conversation_id) return;
    const input = task.input as unknown as GolfSearchInput;
    const message = `✗ Tee time check at ${input.course_name} failed: ${task.error ?? 'unknown error'}\n\nThe URL ${input.course_website} may not be the right booking page. Ask me to try a different one or search again.`;
    await appendSystemMessageToConversation(task.conversation_id, task.user_id, message);
  },
};

export const golfBookHandler: TaskHandler = {
  type: 'golf.book',
  provider: 'skyvern',

  async run(task: TaskRow): Promise<RunResult> {
    const input = task.input as unknown as GolfBookInput;
    const skyvernTask = await createBookingTask({
      url: input.course_website,
      courseName: input.course_name,
      date: input.date,
      time: input.time,
      players: input.players,
    });

    return {
      external_provider: 'skyvern',
      external_id: skyvernTask.task_id,
      progress_message: 'Starting booking...',
    };
  },

  async poll(task: TaskRow): Promise<PollResult> {
    if (!task.external_id) {
      return { status: 'failed', error: 'No external_id to poll' };
    }
    const skyvern = await skyvernGetTask(task.external_id);
    const status = mapSkyvernStatus(skyvern.status);

    if (status === 'completed') {
      return {
        status: 'completed',
        output: (skyvern.extracted_information as Record<string, unknown>) ?? {},
      };
    }
    if (status === 'failed') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reason = (skyvern as any).failure_reason ?? 'Booking failed';
      return { status: 'failed', error: reason };
    }
    return { status: 'running' };
  },

  async onComplete(task: TaskRow): Promise<void> {
    if (!task.conversation_id) return;
    const input = task.input as unknown as GolfBookInput;
    const output = task.output ?? {};
    const message = `✓ Booking completed at ${input.course_name} for ${input.date} ${input.time} (${input.players} players).\n\n${JSON.stringify(output, null, 2)}`;
    await appendSystemMessageToConversation(task.conversation_id, task.user_id, message);
  },

  async onFailed(task: TaskRow): Promise<void> {
    if (!task.conversation_id) return;
    const input = task.input as unknown as GolfBookInput;
    const message = `✗ Booking at ${input.course_name} for ${input.date} ${input.time} failed: ${task.error ?? 'unknown error'}`;
    await appendSystemMessageToConversation(task.conversation_id, task.user_id, message);
  },
};
