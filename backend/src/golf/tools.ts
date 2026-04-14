import type Anthropic from '@anthropic-ai/sdk';
import { searchCourses, filterByDistance } from './golfcourseapi.js';
import { geocodeZip } from './places.js';
import { createTask, getTaskForUser } from '../tasks/index.js';

// Default location: 98011 (Bothell, WA)
const DEFAULT_LAT = 47.7606;
const DEFAULT_LNG = -122.2053;

export const GOLF_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_golf_courses',
    description:
      'Search golf courses by name, club, or city using GolfCourseAPI. Returns course info (name, address, location, par, yardage). ' +
      'Use this to find a specific course (e.g. "Bellevue Golf Course") or all courses in a city (e.g. "Bellevue, WA"). ' +
      'Can filter results by distance from a zip code or coordinates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search term — course name, club name, or city (e.g. "Bellevue", "Pinehurst", "Kirkland WA")',
        },
        near_zip: {
          type: 'string',
          description: 'Optional: US zip code to filter/sort results by distance',
        },
        radius_miles: {
          type: 'number',
          description: 'Optional: max distance in miles from near_zip (default 30)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'check_tee_times_at_course',
    description:
      'START a BACKGROUND task to check tee time availability at a golf course. Returns IMMEDIATELY with a task_id. ' +
      'The task runs in the background for 1-3 minutes. When it completes, a message will automatically be added to the chat with the results (the user does NOT need to ask for status).\n\n' +
      'Before calling: (1) search_memory for "[course name] booking URL" — if saved, use it. ' +
      '(2) If not in memory, web_search for "[course name] tee time booking" to find the real booking URL. ' +
      'NEVER guess URLs. Prefer course-direct and TeeItUp/foreUP/Chronogolf over GolfNow.',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_website: {
          type: 'string',
          description: 'The golf course booking URL',
        },
        course_name: {
          type: 'string',
          description: 'Name of the golf course',
        },
        date: {
          type: 'string',
          description: 'Date to check in YYYY-MM-DD format',
        },
        players: {
          type: 'number',
          description: 'Number of players (optional)',
        },
      },
      required: ['course_website', 'course_name', 'date'],
    },
  },
  {
    name: 'book_tee_time',
    description:
      'START a BACKGROUND task to book a specific tee time. Returns IMMEDIATELY with a task_id. ' +
      'Task runs 2-3 minutes. Result will auto-appear in the chat when complete. Only call after user confirms.',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_website: { type: 'string' },
        course_name: { type: 'string' },
        date: { type: 'string' },
        time: { type: 'string' },
        players: { type: 'number' },
      },
      required: ['course_website', 'course_name', 'date', 'time', 'players'],
    },
  },
  {
    name: 'get_task_status',
    description:
      'Get the current status of a task (by task_id). Only call this if the user explicitly asks about a task. ' +
      'Normally, task results auto-appear in the chat when done — you do NOT need to poll.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: {
          type: 'string',
          description: 'The internal task ID (UUID)',
        },
      },
      required: ['task_id'],
    },
  },
];

interface SearchCoursesInput {
  query: string;
  near_zip?: string;
  radius_miles?: number;
}

interface CheckTeeTimesInput {
  course_website: string;
  course_name: string;
  date: string;
  players?: number;
}

interface BookTeeTimeInput {
  course_website: string;
  course_name: string;
  date: string;
  time: string;
  players: number;
}

interface GetTaskStatusInput {
  task_id: string;
}

export async function executeGolfTool(
  name: string,
  input: unknown,
  userId: string,
  conversationId?: string,
): Promise<string> {
  console.log(`[golf] executing ${name} with input:`, JSON.stringify(input));
  try {
    switch (name) {
      case 'search_golf_courses': {
        const params = input as SearchCoursesInput;
        const results = await searchCourses(params.query);
        if (results.length === 0) {
          return `No golf courses found matching "${params.query}".`;
        }

        let filtered: Array<(typeof results)[0] & { distanceMiles?: number }> = results;
        if (params.near_zip) {
          const center = await geocodeZip(params.near_zip);
          if (center) {
            filtered = filterByDistance(results, center.lat, center.lng, params.radius_miles ?? 30);
          }
        }

        if (filtered.length === 0) {
          return `Found ${results.length} courses matching "${params.query}" but none within ${params.radius_miles ?? 30} miles of ${params.near_zip}.`;
        }

        const lines: string[] = [`Found ${filtered.length} course${filtered.length === 1 ? '' : 's'}:\n`];
        for (const c of filtered.slice(0, 15)) {
          const distance = c.distanceMiles !== undefined ? ` — ${c.distanceMiles.toFixed(1)} mi` : '';
          const displayName = c.clubName === c.courseName ? c.clubName : `${c.clubName} — ${c.courseName}`;
          lines.push(`**${displayName}**${distance}`);
          lines.push(`  ${c.address}`);
          if (c.par) lines.push(`  Par ${c.par}, ${c.holes ?? '?'} holes, ${c.yardage ?? '?'} yards`);
          lines.push('');
        }
        lines.push('\nNote: GolfCourseAPI provides course data but not booking websites. Use web_search to find the booking page.');
        return lines.join('\n');
      }

      case 'check_tee_times_at_course': {
        const params = input as CheckTeeTimesInput;
        const task = await createTask({
          userId,
          type: 'golf.search',
          input: params as unknown as Record<string, unknown>,
          conversationId,
        });
        return `Started tee time check for ${params.course_name} on ${params.date}.\n\n` +
          `Task ID: \`${task.id}\`\n` +
          `URL: ${params.course_website}\n\n` +
          `Running in the background. The user can close this page — results will automatically appear in the chat (and on the /tasks page) when complete (~1-3 min).`;
      }

      case 'book_tee_time': {
        const params = input as BookTeeTimeInput;
        const task = await createTask({
          userId,
          type: 'golf.book',
          input: params as unknown as Record<string, unknown>,
          conversationId,
        });
        return `Started booking task for ${params.course_name} on ${params.date} at ${params.time} (${params.players} players).\n\n` +
          `Task ID: \`${task.id}\`\n\n` +
          `Running in the background. Confirmation will appear in the chat when complete (~2-3 min).`;
      }

      case 'get_task_status': {
        const params = input as GetTaskStatusInput;
        const task = await getTaskForUser(params.task_id, userId);
        if (!task) return `Task ${params.task_id} not found.`;
        return `Task ${task.id}:\nType: ${task.type}\nStatus: ${task.status}\n` +
          (task.progress_message ? `Progress: ${task.progress_message}\n` : '') +
          (task.output ? `Output: ${JSON.stringify(task.output).slice(0, 500)}\n` : '') +
          (task.error ? `Error: ${task.error}\n` : '');
      }

      default:
        return `Error: Unknown golf tool "${name}"`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[golf] ${name} failed:`, err);
    return `Error executing ${name}: ${message}`;
  }
}
