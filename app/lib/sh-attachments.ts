// ─────────────────────────────────────────────────────────────────────────────
// SH 게시판 첨부파일 (S3 결정 2026-08-23: 공고문 PDF를 받아 공급주택을 뽑는다)
//
// SH 게시판은 Innorix 컴포넌트로 첨부를 내려주며, 상세 페이지 스크립트에
// `initParam.downList = [{brdId, seq, fileSeq, fileSize, oriFileNm, fileTp}]`
// 형태의 목록이 박혀 있다. 실제 다운로드 주소는 스파이크로 확인했다:
// https://www.i-sh.co.kr/app/com/file/innoFD.do?brdId=..&seq=..&fileTp=..&fileSeq=..
// ─────────────────────────────────────────────────────────────────────────────

export type ShAttachment = {
  fileSeq: string;
  name: string;
  size: number;
  downloadUrl: string;
};

const INNOFD_BASE = "https://www.i-sh.co.kr/app/com/file/innoFD.do";

export function extractShAttachments(html: string): ShAttachment[] {
  const match = html.match(/initParam\.downList\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return [];

  try {
    const list = JSON.parse(match[1]) as Array<Record<string, unknown>>;
    return list
      .filter((file) => file && typeof file.oriFileNm === "string")
      .map((file) => {
        const params = new URLSearchParams({
          brdId: String(file.brdId ?? ""),
          seq: String(file.seq ?? ""),
          fileTp: String(file.fileTp ?? "A"),
          fileSeq: String(file.fileSeq ?? ""),
        });
        return {
          fileSeq: String(file.fileSeq ?? ""),
          name: String(file.oriFileNm),
          size: Number(file.fileSize) || 0,
          downloadUrl: `${INNOFD_BASE}?${params.toString()}`,
        };
      });
  } catch {
    return []; // 형식이 바뀌면 없는 것으로 — 화면은 원문 확인으로 안내한다
  }
}

/** 파싱 대상 상한. 공고문 PDF는 수백 KB~수 MB 수준이다. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** 공고문 PDF를 고른다. '공고'가 이름에 든 PDF 우선, 없으면 첫 PDF. */
export function pickNoticePdf(attachments: ShAttachment[]): ShAttachment | null {
  const pdfs = attachments.filter(
    (file) => file.name.toLowerCase().endsWith(".pdf") && file.size > 0 && file.size <= MAX_PDF_BYTES,
  );
  return pdfs.find((file) => file.name.includes("공고")) ?? pdfs[0] ?? null;
}
