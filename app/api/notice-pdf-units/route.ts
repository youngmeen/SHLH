import { NOTICE_FETCH_TIMEOUT_MS, NOTICE_REQUEST_HEADERS } from "../../lib/notice-http.ts";
import { extractShAttachments, pickNoticePdf, MAX_PDF_BYTES } from "../../lib/sh-attachments.ts";
import { extractHousingRows, extractPdfLines } from "../../lib/pdf-units.ts";

// 공고문 PDF에서 공급주택(단지명·소재지·전용면적)을 뽑는다 (S3 · 2026-08-23).
// SH 게시판 전용이다 — LH 상세는 별도 구조라 이 경로를 쓰지 않는다.

const ALLOWED_SH_HOSTS = new Set(["www.i-sh.co.kr", "i-sh.co.kr"]);

function isShBoardUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_SH_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

// PDF 파싱은 무겁다(수 초). 같은 공고를 다시 열 때 다시 내려받지 않도록
// 하루 캐시한다 — 공고문 첨부는 등록 후 바뀌는 일이 드물고, 정정은 새
// 공고(seq)로 올라온다.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" };

export async function GET(request: Request) {
  const sourceUrl = new URL(request.url).searchParams.get("sourceUrl") ?? "";
  if (!isShBoardUrl(sourceUrl)) {
    return Response.json({ message: "SH 게시판 공고 주소가 아닙니다." }, { status: 400 });
  }

  try {
    const pageResponse = await fetch(sourceUrl, {
      headers: NOTICE_REQUEST_HEADERS,
      signal: AbortSignal.timeout(NOTICE_FETCH_TIMEOUT_MS),
    });
    if (!pageResponse.ok) throw new Error(`게시판 상세 HTTP ${pageResponse.status}`);

    const attachment = pickNoticePdf(extractShAttachments(await pageResponse.text()));
    if (!attachment) {
      return Response.json(
        { attachment: null, rows: [], message: "공고문 PDF 첨부를 찾지 못했습니다. 원문에서 확인하세요." },
        { headers: CACHE_HEADERS },
      );
    }

    const pdfResponse = await fetch(attachment.downloadUrl, {
      headers: NOTICE_REQUEST_HEADERS,
      signal: AbortSignal.timeout(NOTICE_FETCH_TIMEOUT_MS * 3),
    });
    if (!pdfResponse.ok) throw new Error(`공고문 PDF HTTP ${pdfResponse.status}`);

    const buffer = await pdfResponse.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_BYTES) throw new Error("공고문 PDF가 파싱 상한(20MB)을 넘습니다.");

    const rows = extractHousingRows(await extractPdfLines(new Uint8Array(buffer)));
    return Response.json({ attachment: attachment.name, rows }, { headers: CACHE_HEADERS });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "공고문 PDF를 읽지 못했습니다.";
    return Response.json({ message }, { status: 502 });
  }
}
