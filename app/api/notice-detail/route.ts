import { isAllowedNoticeUrl, parseNoticeDetailHtml } from "../../lib/notice-detail.ts";

const REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "User-Agent": "Jibalrim-MVP/0.1 (public-housing-notice-monitor)",
};

export async function GET(request: Request) {
  const sourceUrl = new URL(request.url).searchParams.get("sourceUrl") ?? "";
  if (!isAllowedNoticeUrl(sourceUrl)) {
    return Response.json({ message: "허용되지 않은 공고 주소입니다." }, { status: 400 });
  }

  try {
    const response = await fetch(sourceUrl, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(12_000),
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
