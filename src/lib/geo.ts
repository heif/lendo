// Neighborhood from coordinates. v1: OpenStreetMap Nominatim (free, low volume — fine for listing-time lookups).
// Swap for Mapbox/Google or an NTA polygon table when volume grows.
export async function hoodFor(lat: number, lng: number): Promise<{ hood: string | null; city: string | null }> {
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`;
    const r = await fetch(u, { headers: { 'User-Agent': 'Lendo/0.1 (neighborhood lookup)' } });
    if (!r.ok) return { hood: null, city: null };
    const j = (await r.json()) as any;
    const a = j.address || {};
    const hood = a.neighbourhood || a.suburb || a.quarter || a.city_district || a.borough || null;
    const city = a.city || a.town || a.village || a.county || null;
    return { hood, city };
  } catch {
    return { hood: null, city: null };
  }
}

// Forward geocode a neighborhood name (fallback when the lister denied location). Biased to NYC for v1.
export async function geocodeHood(place: string, city = 'New York'): Promise<{ lat: number; lng: number } | null> {
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place + ', ' + city)}`;
    const r = await fetch(u, { headers: { 'User-Agent': 'Lendo/0.1 (neighborhood lookup)' } });
    if (!r.ok) return null;
    const j = (await r.json()) as any[];
    if (!j.length) return null;
    return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
  } catch { return null; }
}

export function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8, toR = (d: number) => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
