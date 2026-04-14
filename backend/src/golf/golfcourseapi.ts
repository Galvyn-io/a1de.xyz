// GolfCourseAPI — text search for golf courses by name/club/city
import { config } from '../config.js';

const BASE = 'https://api.golfcourseapi.com/v1';

export interface GolfCourseResult {
  id: number;
  clubName: string;
  courseName: string;
  address: string;
  city: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  holes: number | null;
  par: number | null;
  yardage: number | null;
}

interface ApiCourse {
  id: number;
  club_name?: string;
  course_name?: string;
  location?: {
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  };
  tees?: {
    male?: Array<{
      number_of_holes?: number;
      par_total?: number;
      total_yards?: number;
    }>;
    female?: Array<{
      number_of_holes?: number;
      par_total?: number;
      total_yards?: number;
    }>;
  };
}

function mapCourse(c: ApiCourse): GolfCourseResult {
  const loc = c.location ?? {};
  const firstTee = c.tees?.male?.[0] ?? c.tees?.female?.[0];
  return {
    id: c.id,
    clubName: c.club_name ?? 'Unknown',
    courseName: c.course_name ?? 'Unknown',
    address: loc.address ?? '',
    city: loc.city ?? '',
    state: loc.state ?? '',
    country: loc.country ?? '',
    latitude: loc.latitude ?? 0,
    longitude: loc.longitude ?? 0,
    holes: firstTee?.number_of_holes ?? null,
    par: firstTee?.par_total ?? null,
    yardage: firstTee?.total_yards ?? null,
  };
}

export async function searchCourses(query: string): Promise<GolfCourseResult[]> {
  const url = `${BASE}/search?search_query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Key ${config.GOLF_COURSE_API_KEY}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GolfCourseAPI search error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { courses?: ApiCourse[] };
  return (data.courses ?? []).map(mapCourse);
}

export async function getCourseById(id: number): Promise<GolfCourseResult | null> {
  const res = await fetch(`${BASE}/courses/${id}`, {
    headers: {
      Authorization: `Key ${config.GOLF_COURSE_API_KEY}`,
    },
  });

  if (!res.ok) return null;
  const data = (await res.json()) as ApiCourse;
  return mapCourse(data);
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Helper: filter search results to those within radiusMiles of a point
export function filterByDistance(
  courses: GolfCourseResult[],
  lat: number,
  lng: number,
  radiusMiles: number,
): Array<GolfCourseResult & { distanceMiles: number }> {
  return courses
    .map((c) => ({
      ...c,
      distanceMiles: haversineMiles(lat, lng, c.latitude, c.longitude),
    }))
    .filter((c) => c.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}
