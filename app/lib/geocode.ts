import { inArray } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { geocode } from "../../db/schema.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 주소 → 좌표 (지도 표시 · 2026-08-23)
//
// 제공자는 두 갈래다. KAKAO_REST_API_KEY가 있으면 카카오 주소 검색(빠름),
// 없으면 Nominatim(OpenStreetMap · 키 불필요 · 초당 1건 제한 준수).
// 어느 쪽이든 결과를 geocode 테이블에 영구 캐시해 같은 주소를 두 번 묻지
// 않는다 — 좌표를 못 찾은 것도 캐시한다(매번 다시 물어보지 않게).
// 보내는 것은 공공주택 주소뿐이며 프로필은 보내지 않는다(R47).
// ─────────────────────────────────────────────────────────────────────────────

export type GeoPoint = { query: string; lat: number; lng: number };

/** Nominatim 응답에서 좌표를 읽는다. 못 읽으면 null. */
export function parseNominatim(json: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const first = json[0] as { lat?: string; lon?: string };
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** 카카오 주소 검색 응답에서 좌표를 읽는다. 못 읽으면 null. */
export function parseKakao(json: unknown): { lat: number; lng: number } | null {
  const documents = (json as { documents?: { x?: string; y?: string }[] })?.documents;
  if (!Array.isArray(documents) || documents.length === 0) return null;
  const lat = Number(documents[0].y);
  const lng = Number(documents[0].x);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

const NOMINATIM_INTERVAL_MS = 1100; // 사용 정책: 초당 1건
let lastNominatimAt = 0;

async function lookup(query: string): Promise<{ lat: number; lng: number } | null> {
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (kakaoKey) {
    const response = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`,
      { headers: { Authorization: `KakaoAK ${kakaoKey}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) throw new Error(`카카오 지오코딩 HTTP ${response.status}`);
    return parseKakao(await response.json());
  }

  const wait = lastNominatimAt + NOMINATIM_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimAt = Date.now();

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=kr`,
    { headers: { "User-Agent": "jib-alim/0.1 (personal housing tool)" }, signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  return parseNominatim(await response.json());
}

/**
 * 질의 목록의 좌표를 돌려준다. 캐시에 없는 것은 최대 `budget`건만 새로
 * 알아보고, 나머지는 pending으로 남긴다 — Nominatim 경로에서 한 요청이
 * 너무 오래 붙잡히지 않게 하기 위한 상한이다. 클라이언트는 pending이
 * 0이 될 때까지 다시 부른다.
 */
export async function geocodeQueries(queries: string[], budget: number): Promise<{ points: GeoPoint[]; pending: number }> {
  const unique = [...new Set(queries)];
  if (unique.length === 0) return { points: [], pending: 0 };

  const db = getDb();
  const cached = await db.select().from(geocode).where(inArray(geocode.query, unique));
  const cachedByQuery = new Map(cached.map((row) => [row.query, row]));

  const points: GeoPoint[] = [];
  for (const row of cached) {
    if (row.lat !== null && row.lng !== null) points.push({ query: row.query, lat: row.lat, lng: row.lng });
  }

  const misses = unique.filter((query) => !cachedByQuery.has(query));
  let fetched = 0;
  for (const query of misses) {
    if (fetched >= budget) break;
    fetched += 1;
    let result: { lat: number; lng: number } | null = null;
    try {
      result = await lookup(query);
    } catch {
      // 제공자 오류는 이번 요청에서 pending으로 남긴다 — 캐시에 실패를
      // 못 찾음(null)으로 기록하면 일시 장애가 영구화된다.
      fetched -= 1;
      break;
    }
    await db
      .insert(geocode)
      .values({ query, lat: result?.lat ?? null, lng: result?.lng ?? null, provider: process.env.KAKAO_REST_API_KEY ? "kakao" : "nominatim" })
      .onConflictDoNothing();
    if (result) points.push({ query, lat: result.lat, lng: result.lng });
  }

  return { points, pending: misses.length - fetched };
}
