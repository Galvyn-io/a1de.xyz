import type Anthropic from '@anthropic-ai/sdk';
import { searchCourses, filterByDistance } from './golfcourseapi.js';
import { geocodeZip } from './places.js';
import { searchTeeTimesOnSite, createBookingTask, getTaskStatus } from './skyvern.js';
import { addMemory } from '../memory/db.js';

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
      'START a background task to check tee time availability at a golf course. Returns IMMEDIATELY with a task ID — does NOT wait for results. ' +
      'The task runs in the background for 1-3 minutes. Tell the user the task is running and they can ask for status anytime (even later, or after refreshing the page). ' +
      'Use check_task_status to retrieve the result.\n\n' +
      'CRITICAL: Before calling this, use search_memory to see if the booking URL is already saved for this course. ' +
      'If not in memory, use web_search to find the actual booking URL — do NOT guess or construct URLs. ' +
      'Many golf courses use third-party booking systems (teesheet.com, foreupsoftware.com, chronogolf.com, golfnow.com).',
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
    name: 'check_task_status',
    description:
      'Check the status/result of a previously-started check_tee_times_at_course or book_tee_time task. ' +
      'If the task succeeded, the booking URL is automatically saved to memory for next time. ' +
      'If the user asks about a task started earlier (even in a previous conversation), use this with the task_id they mention.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: {
          type: 'string',
          description: 'The task ID from a previous check_tee_times_at_course or book_tee_time call',
        },
        course_name: {
          type: 'string',
          description: 'Course name (optional — used to save URL as memory if successful)',
        },
        course_website: {
          type: 'string',
          description: 'The URL that was used (optional — saved to memory if task succeeded)',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'book_tee_time',
    description:
      'Book a specific tee time at a golf course using browser automation. Only call this AFTER the user has confirmed which course and time they want. Takes 60-90 seconds.',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_website: {
          type: 'string',
          description: 'The golf course booking website URL',
        },
        course_name: {
          type: 'string',
          description: 'Name of the golf course',
        },
        date: {
          type: 'string',
          description: 'Date (YYYY-MM-DD)',
        },
        time: {
          type: 'string',
          description: 'Tee time (e.g. "2:30 PM")',
        },
        players: {
          type: 'number',
          description: 'Number of players',
        },
      },
      required: ['course_website', 'course_name', 'date', 'time', 'players'],
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

interface CheckTaskStatusInput {
  task_id: string;
  course_name?: string;
  course_website?: string;
}

export async function executeGolfTool(name: string, input: unknown, userId?: string): Promise<string> {
  console.log(`[golf] executing ${name} with input:`, JSON.stringify(input));
  try {
    switch (name) {
      case 'search_golf_courses': {
        const params = input as SearchCoursesInput;

        const results = await searchCourses(params.query);

        if (results.length === 0) {
          return `No golf courses found matching "${params.query}".`;
        }

        // Optionally filter by distance from a zip
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

        const lines: string[] = [
          `Found ${filtered.length} course${filtered.length === 1 ? '' : 's'}:\n`,
        ];

        for (const c of filtered.slice(0, 15)) {
          const distance = c.distanceMiles !== undefined ? ` — ${c.distanceMiles.toFixed(1)} mi` : '';
          const displayName = c.clubName === c.courseName ? c.clubName : `${c.clubName} — ${c.courseName}`;
          lines.push(`**${displayName}**${distance}`);
          lines.push(`  ${c.address}`);
          if (c.par) lines.push(`  Par ${c.par}, ${c.holes ?? '?'} holes, ${c.yardage ?? '?'} yards`);
          lines.push(`  (course id: ${c.id})`);
          lines.push('');
        }

        lines.push(
          '\nNote: GolfCourseAPI provides course data but not booking websites. To check tee times, you may need the course\'s booking website URL.',
        );

        return lines.join('\n');
      }

      case 'check_tee_times_at_course': {
        const params = input as CheckTeeTimesInput;

        const task = await searchTeeTimesOnSite({
          url: params.course_website,
          courseName: params.course_name,
          date: params.date,
          players: params.players,
        });

        return `Started tee time check for ${params.course_name} on ${params.date}.\n\n` +
          `Task ID: \`${task.task_id}\`\n` +
          `URL being checked: ${params.course_website}\n\n` +
          `This runs in the background for 1-3 minutes. The user can close this page and come back — ask for the task status anytime using the task ID above. ` +
          `I'll save the booking URL to memory if the check succeeds, so we won't need to search for it next time.`;
      }

      case 'book_tee_time': {
        const params = input as BookTeeTimeInput;

        const task = await createBookingTask({
          url: params.course_website,
          courseName: params.course_name,
          date: params.date,
          time: params.time,
          players: params.players,
        });

        return `Started booking task for ${params.course_name} on ${params.date} at ${params.time} for ${params.players} player(s).\n\n` +
          `Task ID: \`${task.task_id}\`\n\n` +
          `Runs in the background for 2-3 minutes. User can close the page and check back later. ` +
          `Use check_task_status with this task ID to retrieve the booking confirmation.`;
      }

      case 'check_task_status': {
        const params = input as CheckTaskStatusInput;

        const result = await getTaskStatus(params.task_id);

        if (result.status === 'created' || result.status === 'queued' || result.status === 'running') {
          return `Task ${params.task_id} is still ${result.status}. Please check again in 30-60 seconds.`;
        }

        if (result.status === 'failed' || result.status === 'terminated') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const failureReason = (result as any).failure_reason ?? 'no reason provided';
          return `Task ${params.task_id} ${result.status}. Reason: ${failureReason}\n\n` +
            (params.course_website ? `The URL ${params.course_website} did not work. Try searching the web for a different booking page.` : '');
        }

        if (result.status === 'completed') {
          const extracted = result.extracted_information;

          // Save the booking URL to memory since it worked
          if (userId && params.course_name && params.course_website) {
            try {
              await addMemory({
                userId,
                content: `${params.course_name} booking URL: ${params.course_website}`,
                source: 'golf_verified',
                category: 'project',
                alwaysInject: false,
                entities: [params.course_name],
              });
            } catch (e) {
              console.error('[golf] failed to save URL to memory:', e);
            }
          }

          if (!extracted) {
            return `Task ${params.task_id} completed but returned no data. The site may require login or have no availability.`;
          }

          return `Task ${params.task_id} completed!\n\nResult:\n${JSON.stringify(extracted, null, 2)}` +
            (params.course_name && params.course_website ? `\n\n(Booking URL saved to memory for future use.)` : '');
        }

        return `Task ${params.task_id} status: ${result.status}`;
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
