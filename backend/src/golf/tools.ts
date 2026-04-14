import type Anthropic from '@anthropic-ai/sdk';
import { searchGolfCourses, geocodeZip } from './places.js';
import { searchTeeTimesOnSite, createBookingTask, waitForTask } from './skyvern.js';

// Default location: 98011 (Bothell, WA)
const DEFAULT_LAT = 47.7606;
const DEFAULT_LNG = -122.2053;

export const GOLF_TOOLS: Anthropic.Tool[] = [
  {
    name: 'find_golf_courses',
    description:
      'Find golf courses near a location using Google Places. Returns course names, addresses, websites, ratings, and distances. ' +
      'Use this FIRST to discover what courses exist in an area before searching tee times.',
    input_schema: {
      type: 'object' as const,
      properties: {
        zip_code: {
          type: 'string',
          description: 'US zip code (e.g. "98011"). Used to find the search center.',
        },
        latitude: {
          type: 'number',
          description: 'Latitude of search center (alternative to zip_code)',
        },
        longitude: {
          type: 'number',
          description: 'Longitude of search center (alternative to zip_code)',
        },
        radius_miles: {
          type: 'number',
          description: 'Search radius in miles (default 20, max 31)',
        },
      },
      required: [],
    },
  },
  {
    name: 'check_tee_times_at_course',
    description:
      'Check tee time availability at a specific golf course by navigating their website. Uses browser automation (takes 30-60 seconds). ' +
      'Call this AFTER find_golf_courses to check one or more courses for availability.',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_website: {
          type: 'string',
          description: 'The golf course website URL',
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
          description: 'The golf course website URL',
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

interface FindCoursesInput {
  zip_code?: string;
  latitude?: number;
  longitude?: number;
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
  try {
    switch (name) {
      case 'find_golf_courses': {
        const params = input as FindCoursesInput;

        let lat = params.latitude;
        let lng = params.longitude;

        if (params.zip_code && (!lat || !lng)) {
          const geo = await geocodeZip(params.zip_code);
          if (!geo) return `Could not find location for zip code: ${params.zip_code}`;
          lat = geo.lat;
          lng = geo.lng;
        }

        if (!lat || !lng) {
          lat = DEFAULT_LAT;
          lng = DEFAULT_LNG;
        }

        const courses = await searchGolfCourses({
          latitude: lat,
          longitude: lng,
          radiusMiles: params.radius_miles ?? 20,
        });

        if (courses.length === 0) {
          return `No golf courses found within ${params.radius_miles ?? 20} miles.`;
        }

        const lines: string[] = [`Found ${courses.length} golf course${courses.length === 1 ? '' : 's'}:\n`];

        for (const c of courses) {
          const rating = c.rating ? ` ⭐ ${c.rating.toFixed(1)} (${c.userRatingCount ?? 0})` : '';
          const distance = c.distanceMiles ? ` — ${c.distanceMiles.toFixed(1)} mi` : '';
          lines.push(`**${c.name}**${distance}${rating}`);
          lines.push(`  ${c.address}`);
          if (c.website) lines.push(`  Website: ${c.website}`);
          if (c.phone) lines.push(`  Phone: ${c.phone}`);
          lines.push('');
        }

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

        // Wait for the task to complete
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

        return `Booking task started for ${params.course_name} on ${params.date} at ${params.time} for ${params.players} player(s).\n\nTask ID: ${task.task_id}\nStatus: ${task.status}\n\nThe booking is being processed. This typically takes 60-90 seconds. Ask me to check the status if needed.`;
      }

      default:
        return `Error: Unknown golf tool "${name}"`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return `Error executing ${name}: ${message}`;
  }
}
