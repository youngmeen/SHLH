import { geocodeQueries } from "../../lib/geocode.ts";

// 주소 목록 → 좌표 목록. 화면의 지도가 쓴다.
// 질의는 화면이 우리 데이터(공고·재고 주소)로 만든 것이지만, 남용을 막기 위해
// 개수·길이·서울 포함을 검사한다.

const MAX_QUERIES = 80;
const BUDGET_PER_CALL = 20; // Nominatim 경로에서 한 번에 최대 ~22초

export async function POST(request: Request) {
  let queries: unknown;
  try {
    queries = ((await request.json()) as { queries?: unknown }).queries;
  } catch {
    return Response.json({ message: "본문이 JSON이 아닙니다." }, { status: 400 });
  }

  if (!Array.isArray(queries) || queries.length === 0 || queries.length > MAX_QUERIES) {
    return Response.json({ message: `queries는 1~${MAX_QUERIES}개여야 합니다.` }, { status: 400 });
  }
  const cleaned = queries.filter(
    (query): query is string => typeof query === "string" && query.length <= 120 && query.includes("서울"),
  );
  if (cleaned.length !== queries.length) {
    return Response.json({ message: "서울 주소 문자열만 받을 수 있습니다." }, { status: 400 });
  }

  try {
    const result = await geocodeQueries(cleaned, BUDGET_PER_CALL);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "좌표를 확인하지 못했습니다.";
    return Response.json({ message }, { status: 502 });
  }
}
