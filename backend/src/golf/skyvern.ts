// Skyvern cloud API for browser-automated golf tasks
import { config } from '../config.js';

const SKYVERN_BASE = 'https://api.skyvern.com/api/v1';

interface SkyvernTask {
  task_id: string;
  status: string;
  request?: unknown;
  extracted_information?: unknown;
  output?: unknown;
}

async function skyvernFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SKYVERN_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.SKYVERN_API_KEY,
      ...(init?.headers ?? {}),
    },
  });
}

// Search for tee times on a golf course website
export async function searchTeeTimesOnSite(params: {
  url: string;
  courseName: string;
  date: string;
  players?: number;
}): Promise<SkyvernTask> {
  const navigationGoal = `You are on ${params.courseName}'s website. Find the page or section for booking a tee time. Navigate to it and look for available tee times on ${params.date}${params.players ? ` for ${params.players} player(s)` : ''}. Do NOT log in. Do NOT complete a booking. Just find and list the available times and their prices.`;

  const dataExtractionGoal = `Extract a list of available tee times for ${params.date}. For each tee time, return: time (e.g. "2:30 PM"), price (number in USD), rate_type (e.g. "standard", "twilight", "senior"), players_available (number). If the site requires login to see times, return that in a "requires_login" field. If no tee times are available, return an empty list.`;

  const res = await skyvernFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      url: params.url,
      navigation_goal: navigationGoal,
      data_extraction_goal: dataExtractionGoal,
      max_steps_override: 15,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Skyvern search error (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<SkyvernTask>;
}

// Book a specific tee time
export async function createBookingTask(params: {
  url: string;
  courseName: string;
  date: string;
  time: string;
  players: number;
  credentials?: { email: string; password: string };
}): Promise<SkyvernTask> {
  const navigationGoal = params.credentials
    ? `Log in with email "${params.credentials.email}" and password "${params.credentials.password}". Then book a tee time at ${params.courseName} for ${params.date} at ${params.time} for ${params.players} player(s). Complete the booking and capture the confirmation number.`
    : `Book a tee time at ${params.courseName} for ${params.date} at ${params.time} for ${params.players} player(s). Complete the booking and capture the confirmation number.`;

  const res = await skyvernFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      url: params.url,
      navigation_goal: navigationGoal,
      data_extraction_goal:
        'Extract the confirmation number, total price, and tee time details after booking is complete.',
      max_steps_override: 20,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Skyvern booking error (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<SkyvernTask>;
}

export async function getTaskStatus(taskId: string): Promise<SkyvernTask> {
  const res = await skyvernFetch(`/tasks/${taskId}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Skyvern status error (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<SkyvernTask>;
}

// Poll until task completes or times out
export async function waitForTask(taskId: string, timeoutMs = 240000): Promise<SkyvernTask> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await getTaskStatus(taskId);
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'terminated') {
      return task;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Skyvern task ${taskId} timed out after ${timeoutMs}ms`);
}
