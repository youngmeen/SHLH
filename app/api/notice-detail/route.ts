import { isAllowedNoticeUrl, parseNoticeDetailHtml } from "../../lib/notice-detail.ts";
import { NOTICE_FETCH_TIMEOUT_MS, NOTICE_REQUEST_HEADERS } from "../../lib/notice-http.ts";

export async function GET(request: Request) {
  const sourceUrl = new URL(request.url).searchParams.get("sourceUrl") ?? "";
  if (!isAllowedNoticeUrl(sourceUrl)) {
    return Response.json({ message: "허용되지 않은 공고 주소입니다." }, { status: 400 });
  }

  try {
    const response = await fetch(sourceUrl, {
      headers: NOTICE_REQUEST_HEADERS,
      signal: AbortSignal.timeout(NOTICE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`공고 상세 HTTP ${response.status}`);

    return Response.json(parseNoticeDetailHtml(await response.text()), {
      headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "공고 상세를 불러오지 못했습니다.";
    return Response.json({ message }, { status: 502 });
  }
}
