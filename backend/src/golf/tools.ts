import type Anthropic from '@anthropic-ai/sdk';
import { searchCourses, filterByDistance } from './golfcourseapi.js';
import { geocodeZip } from './places.js';
import { searchTeeTimesOnSite, createBookingTask, waitForTask } from './skyvern.js';

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
      'Check tee time availability at a specific golf course by navigating their website. Uses browser automation (takes 30-60 seconds). ' +
      'Requires the course website URL. If you only have the course name, ask the user for the website or search the web first.',
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

export async function executeGolfTool(name: string, input: unknown): Promise<string> {
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

        const result = await waitForTask(task.task_id);

        if (result.status !== 'completed') {
          return `Tee time search at ${params.course_name} did not complete (status: ${result.status}). You may need to check their website directly: ${params.course_website}`;
        }

        const extracted = result.extracted_information;
        if (!extracted) {
          return `No tee time data extracted for ${params.course_name} on ${params.date}. They may require login, or no times are available.`;
        }

        return `Tee times at ${params.course_name} for ${params.date}:\n${JSON.stringify(extracted, null, 2)}`;
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

        return `Booking task started for ${params.course_name} on ${params.date} at ${params.time} for ${params.players} player(s).\n\nTask ID: ${task.task_id}\nStatus: ${task.status}\n\nThe booking is being processed. This typically takes 60-90 seconds.`;
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
