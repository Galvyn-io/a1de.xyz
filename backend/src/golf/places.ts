// Google Places API (new) for discovering golf courses
import { config } from '../config.js';

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places';

export interface GolfCourse {
  placeId: string;
  name: string;
  address: string;
  phone: string | null;
  website: string | null;
  rating: number | null;
  userRatingCount: number | null;
  location: { lat: number; lng: number };
  distanceMiles?: number;
}

interface PlaceSearchResult {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
    location?: { latitude: number; longitude: number };
  }>;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth's radius in miles
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function searchGolfCourses(params: {
  latitude: number;
  longitude: number;
  radiusMiles?: number;
}): Promise<GolfCourse[]> {
  const radiusMeters = Math.min((params.radiusMiles ?? 20) * 1609.34, 50000); // Places API max 50km

  const res = await fetch(PLACES_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.location',
    },
    body: JSON.stringify({
      includedTypes: ['golf_course'],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: params.latitude, longitude: params.longitude },
          radius: radiusMeters,
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as PlaceSearchResult;
  const places = data.places ?? [];

  return places
    .map((p) => {
      const lat = p.location?.latitude ?? 0;
      const lng = p.location?.longitude ?? 0;
      return {
        placeId: p.id,
        name: p.displayName?.text ?? 'Unknown',
        address: p.formattedAddress ?? '',
        phone: p.nationalPhoneNumber ?? null,
        website: p.websiteUri ?? null,
        rating: p.rating ?? null,
        userRatingCount: p.userRatingCount ?? null,
        location: { lat, lng },
        distanceMiles: haversineMiles(params.latitude, params.longitude, lat, lng),
      };
    })
    .sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));
}

export async function geocodeZip(zip: string): Promise<{ lat: number; lng: number } | null> {
  // Use Places text search for geocoding — simpler than adding Geocoding API
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.location',
    },
    body: JSON.stringify({ textQuery: `${zip} USA` }),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as PlaceSearchResult;
  const loc = data.places?.[0]?.location;
  if (!loc) return null;

  return { lat: loc.latitude, lng: loc.longitude };
}
