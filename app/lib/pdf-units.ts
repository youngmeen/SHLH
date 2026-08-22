// ─────────────────────────────────────────────────────────────────────────────
// 공고문 PDF에서 공급주택(단지명·소재지·전용면적)을 뽑는다 (S3 · 2026-08-23)
//
// 표 전체를 복원하려 들지 않는다 — 공고마다 표 구조가 달라 오파싱 위험이
// 크다(R44). 대신 정밀도가 높은 것만 뽑는다: 도로명주소 패턴이 있는 줄에서
// 주소를, 그 줄과 인접 줄에서 단지명·전용면적을 붙인다. 못 뽑은 값은 비워
// 두고 화면이 "원문 확인"으로 안내한다.
// ─────────────────────────────────────────────────────────────────────────────

export type PdfHousingRow = {
  name: string | null;
  address: string;
  /** 원문 표기 그대로 (예: "29.87~31.05"). 단위는 ㎡. */
  area: string | null;
};

/**
 * PDF 전체를 줄 목록으로 만든다. 같은 y좌표(3pt 격자)의 조각을 한 줄로 묶고
 * x좌표 순으로 " | "로 잇는다 — 표의 셀 경계가 구분자로 남는다.
 * pdfjs는 이 함수 안에서만 불러온다(순수 파서 테스트가 PDF 엔진 없이 돌게).
 */
export async function extractPdfLines(data: Uint8Array): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;
  const lines: string[] = [];

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    const byY = new Map<number, { x: number; str: string }[]>();

    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x: item.transform[4], str: item.str.trim() });
    }

    for (const [, items] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
      lines.push(items.sort((a, b) => a.x - b.x).map((item) => item.str).join(" | "));
    }
  }

  await loadingTask.destroy();
  return lines;
}

// 도로명주소: "시흥대로145길 67", "마곡중앙1로 72", "올림픽로 393", "독산로96길 27-6"
const ADDRESS_PATTERN = /(?:[가-힣]+구\s+)?[가-힣0-9·]+(?:대로|로|길)\s?\d+(?:-\d+)?(?=\s|$|\)|\|)/;
// 전용면적: "29.87~31.05" 범위 또는 "38.09㎡" 단독. 5~200㎡만 인정한다.
const AREA_RANGE = /(\d{1,3}\.\d{1,2})\s*[~∼]\s*(\d{1,3}\.\d{1,2})/;
const AREA_SINGLE = /(\d{1,3}\.\d{1,2})\s*㎡/;

const DISTRICT_ONLY = /^[가-힣]{1,3}구$/;
const NAME_STOPWORDS = new Set(["소재지", "소재지주소", "주택명", "단지명", "자치구", "총세대", "구분", "계"]);

function plausibleArea(value: number) {
  return value >= 5 && value <= 200;
}

function findArea(line: string): string | null {
  const range = line.match(AREA_RANGE);
  if (range && plausibleArea(Number(range[1])) && plausibleArea(Number(range[2]))) {
    return `${range[1]}~${range[2]}`;
  }
  const single = line.match(AREA_SINGLE);
  if (single && plausibleArea(Number(single[1]))) return single[1];
  return null;
}

/** 주소 앞쪽 셀에서 단지명 후보를 찾는다. 자치구명·표 머리말은 건너뛴다. */
function findName(cells: string[], addressCellIndex: number): string | null {
  for (let i = addressCellIndex - 1; i >= 0; i--) {
    const candidate = cells[i].trim();
    if (!candidate || DISTRICT_ONLY.test(candidate) || NAME_STOPWORDS.has(candidate)) continue;
    // 한글이 포함된 이름만 — 숫자·날짜 셀은 단지명이 아니다.
    if (/[가-힣]/.test(candidate) && !/^\d/.test(candidate)) return candidate;
    return null; // 이름 아닌 값이 나오면 더 거슬러 올라가지 않는다
  }
  return null;
}

/** 재구성된 줄에서 공급주택 행을 뽑는다. 같은 주소는 한 번만. */
export function extractHousingRows(lines: string[]): PdfHousingRow[] {
  const rows: PdfHousingRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 날짜(2026. 8. 19.)나 전화번호 줄은 주소 패턴과 겹치지 않지만,
    // "서울시 강서구 B오피스텔"처럼 도로명+번호가 없는 언급도 걸러진다.
    const match = line.match(ADDRESS_PATTERN);
    if (!match) continue;

    const address = match[0].trim();
    if (seen.has(address)) continue;
    seen.add(address);

    const cells = line.split("|").map((cell) => cell.trim());
    const addressCellIndex = cells.findIndex((cell) => cell.includes(address));
    const name = findName(cells, addressCellIndex);

    // 면적은 같은 줄 → 다음 두 줄 순으로 찾는다 (표에서 면적 셀이 다음 줄로
    // 밀려 내려오는 경우가 흔하다).
    const area = findArea(line) ?? findArea(lines[i + 1] ?? "") ?? findArea(lines[i + 2] ?? "");

    rows.push({ name, address, area });
    if (rows.length >= 80) break; // 위치 안내 표가 큰 공고 대비 상한
  }

  return rows;
}
