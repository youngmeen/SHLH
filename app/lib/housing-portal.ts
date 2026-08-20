import { htmlToLines, stripHtmlToText } from "./html-text.ts";
import { NOTICE_FETCH_TIMEOUT_MS, NOTICE_REQUEST_HEADERS, isOfficialNoticeUrl } from "./notice-http.ts";

/**
 * 서울주거포털 SH 공공임대 목록·상세.
 *
 * SH 게시판(i-sh.co.kr)은 접수기간·발표일·모집상태를 주지 않는다. 지금까지 그 값이
 * 전부 null이었다. 같은 공고를 서울주거포털이 표로 정리해 두고, 상세에는 접수기간과
 * 공급호수까지 있다(SPEC 5절).
 *
 * 붙이는 방법 — 목록의 "바로가기" 링크가 SH 게시판 게시물 seq를 그대로 담고 있다.
 * 2026-08-20 실측에서 게시판이 준 seq(308799·308644·308571·308569)와 정확히 같았다.
 * 제목 매칭 같은 추측이 필요 없다.
 *
 * 주의 — 포털 상세 URL의 `seq`는 게시물 ID가 아니라 목록에서의 행 번호다. 새 공고가
 * 올라오면 모든 행의 seq가 밀린다. 그래서 상세는 목록을 읽은 그 자리에서만 따라간다.
 * 이 값을 저장해서 나중에 다시 쓰면 다른 공고를 읽는다.
 *
 * 출처 계층은 B다(공식 사이트의 비문서화 화면). 마크업이 바뀌면 값을 만들지 않고
 * null로 떨어뜨린다(R43·R44).
 */
export const PORTAL_LIST_URL = "https://housing.seoul.go.kr/site/main/sh/publicLease/list";

export function portalDetailUrl(portalSeq: string, page = 1) {
  return `https://housing.seoul.go.kr/site/main/sh/publicLease/view?seq=${portalSeq}&cp=${page}&supplyType=publicLease`;
}

export function portalListUrl(page = 1) {
  return `${PORTAL_LIST_URL}?cp=${page}&supplyType=publicLease`;
}

export type PortalListRow = {
  /** SH 게시판 게시물 seq. 우리가 저장한 SH 공고와 붙이는 키다. */
  shSeq: string | null;
  /** 포털 상세의 행 번호. 목록을 읽은 직후에만 유효하다. */
  portalSeq: string | null;
  title: string;
  noticeType: string | null;
  publishedAt: string | null;
  announceAt: string | null;
  status: string | null;
  department: string | null;
};

export type PortalDetail = {
  title: string | null;
  noticeType: string | null;
  publishedAt: string | null;
  department: string | null;
  applyStart: string | null;
  applyEnd: string | null;
  /** 마감 시각까지 적혀 있을 때만. 없으면 만들지 않는다. */
  applyDeadlineAt: string | null;
  announceAt: string | null;
  /** 원문 그대로. "G밸리하우스-5세대, 소셜믹스형 청년주택-7세대 (총12세대)"를 숫자로 눌러버리지 않는다. */
  supplyCount: string | null;
};

/** 목록과 상세를 합쳐 SH 공고 한 건에 얹을 값. */
export type PortalSupplement = PortalListRow & { detail: PortalDetail | null; detailUrl: string | null };

const DATE_PATTERN = /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/;

/** `2026.08.19.(수)` · `2026-08-19` → `2026-08-19`. 날짜가 없으면 null. */
function toIsoDate(value: string | null | undefined) {
  const match = value?.match(DATE_PATTERN);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function text(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  // 포털은 "아직 없음"을 하이픈으로 쓴다. 하이픈을 값으로 저장하면 미발표가 값이 된다.
  if (trimmed === "" || trimmed === "-") return null;
  return trimmed;
}

/** 데이터 칸만 센다. th를 함께 세면 thead 행이 공고 한 건으로 들어온다. */
function cellsOf(row: string) {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

/**
 * 열 순서를 상수로 박지 않고 thead에서 읽는다. 모집상태 열이 조건부로 렌더되기
 * 때문에(실측) 순서를 고정하면 열이 빠지는 날 담당부서를 상태로 읽는다.
 */
function columnIndex(html: string) {
  const head = html.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? "";
  const labels = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((match) => stripHtmlToText(match[1]));
  const find = (label: string) => {
    const index = labels.indexOf(label);
    return index < 0 ? null : index;
  };
  return {
    noticeType: find("청약유형"),
    title: find("공고명"),
    publishedAt: find("공고게시일"),
    announceAt: find("발표일"),
    status: find("모집상태"),
    department: find("담당부서"),
    link: find("링크"),
  };
}

export function parsePortalList(html: string): PortalListRow[] {
  const column = columnIndex(html);
  const rows: PortalListRow[] = [];

  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = cellsOf(match[1]);
    // thead 행은 td가 없다. 열 수가 모자라는 행은 우리가 아는 표가 아니다.
    if (cells.length < 4) continue;

    const at = (index: number | null) => (index === null ? null : cells[index] ?? null);
    const title = stripHtmlToText(at(column.title) ?? "");
    if (!title) continue;

    const linkCell = at(column.link) ?? match[1];
    rows.push({
      shSeq: linkCell.match(/i-sh\.co\.kr[^"']*[?&]seq=(\d+)/i)?.[1] ?? null,
      portalSeq: (at(column.title) ?? "").match(/publicLease\/view\?seq=(\d+)/i)?.[1] ?? null,
      title,
      noticeType: text(stripHtmlToText(at(column.noticeType) ?? "")),
      publishedAt: toIsoDate(stripHtmlToText(at(column.publishedAt) ?? "")),
      announceAt: toIsoDate(stripHtmlToText(at(column.announceAt) ?? "")),
      status: text(stripHtmlToText(at(column.status) ?? "")),
      department: text(stripHtmlToText(at(column.department) ?? "")),
    });
  }

  return rows;
}

/** 상세 표의 `제목`·`공고일`·`유형`·`담당부서`처럼 th-td가 짝지어 오는 값. */
function labeledValues(block: string) {
  const values = new Map<string, string>();
  let label: string | null = null;

  for (const match of block.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const [, tag, inner] = match;
    if (tag.toLowerCase() === "th") {
      label = stripHtmlToText(inner);
      continue;
    }
    if (label && !values.has(label)) values.set(label, stripHtmlToText(inner));
    label = null;
  }
  return values;
}

// 접수기간이 적힌 줄. `서류제출기간`·`서류심사`는 접수가 아니다.
const APPLY_LINE = /접수기간|인터넷접수|방문접수|우편접수|접수\s*일자|현장접수/;

// 본문은 `■ 항목`과 그 아래 `○ 세부`로 쓰여 있다. 앞머리 안내문(`★ …`)은 항목이 아닌데
// 같은 낱말을 쓴다 — 실측에서 "당첨자 발표 전 공개하지 않으니"가 발표일 줄보다 먼저
// 나왔다. 항목 줄만 보면 안내문을 값으로 읽지 않는다.
const SECTION_MARKER = /^[■□▣▪◾●○◦・]/;

function sectionLines(lines: string[]) {
  const marked = lines.filter((line) => SECTION_MARKER.test(line));
  return marked.length > 0 ? marked : lines;
}

/**
 * 마감일에 연도를 적지 않는 표기가 있다 — `2026.08.18.(화) ~ 08.28.(금) 18:00`(실측).
 * 시작 연도를 붙이고, 시작보다 앞선 날짜가 되면 다음 해로 넘긴다(연말 접수).
 * 연도는 공고문이 적은 시작일에서 온 값이지 우리가 고른 값이 아니다.
 */
function endDateInheritingYear(start: string, month: string, day: string) {
  const year = Number(start.slice(0, 4));
  const candidate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return candidate >= start ? candidate : `${year + 1}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseApplyPeriod(lines: string[]) {
  for (const line of lines) {
    if (!APPLY_LINE.test(line)) continue;
    const dates = [...line.matchAll(new RegExp(DATE_PATTERN, "g"))];
    if (dates.length === 0) continue; // `■ 접수일`처럼 제목만 있는 줄. 다음 줄에 날짜가 온다

    const start = toIsoDate(dates[0][0]);
    if (!start) continue;

    let end: string | null = null;
    let tail = "";
    if (dates.length >= 2) {
      end = toIsoDate(dates[1][0]);
      // 마감 시각은 마감일 뒤에 붙는다 — `2026.09.17.(목) 18시`.
      tail = line.slice((dates[1].index ?? 0) + dates[1][0].length);
    } else {
      const afterStart = line.slice((dates[0].index ?? 0) + dates[0][0].length);
      const partial = afterStart.match(/[~∼-]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
      // 마감일이 없으면 만들지 않는다. 시작만 알고 마감을 짐작하면 R44 위반이다.
      if (!partial) continue;
      end = endDateInheritingYear(start, partial[1], partial[2]);
      tail = afterStart.slice((partial.index ?? 0) + partial[0].length);
    }

    const hour = tail.match(/(\d{1,2})\s*(?:시|:\s*(\d{2}))/);
    const deadlineAt =
      end && hour ? `${end}T${hour[1].padStart(2, "0")}:${(hour[2] ?? "00").padStart(2, "0")}:00+09:00` : null;

    return { start, end, deadlineAt };
  }
  return { start: null, end: null, deadlineAt: null };
}

function valueAfterLabel(lines: string[], pattern: RegExp) {
  for (const line of lines) {
    if (!pattern.test(line)) continue;
    const value = line.split(/[:：]/).slice(1).join(":").trim();
    if (value) return value.replace(/[.\s]+$/, "");
  }
  return null;
}

export function parsePortalDetail(html: string): PortalDetail {
  const start = html.search(/class="board-detail"/i);
  const block = start < 0 ? html : html.slice(start, html.indexOf('class="gap50"', start) + 1 || undefined);
  const labeled = labeledValues(block);

  // `상세 정보` 아래가 본문이다. 항목이 줄 단위라 줄을 살려서 읽는다.
  const bodyStart = block.search(/상세\s*정보/);
  const lines = bodyStart < 0 ? [] : sectionLines(htmlToLines(block.slice(bodyStart)));

  const apply = parseApplyPeriod(lines);
  // `서류심사대상자 발표`를 당첨자 발표로 읽으면 안 된다. 당첨자만, 날짜가 있는 줄만 본다.
  const announceLine = lines.find((line) => /당첨자\s*발표/.test(line) && DATE_PATTERN.test(line)) ?? null;

  return {
    title: text(labeled.get("제목") ?? null),
    noticeType: text(labeled.get("유형") ?? null),
    publishedAt: toIsoDate(labeled.get("공고일") ?? null) ?? toIsoDate(valueAfterLabel(lines, /모집공고일/)),
    department: text(labeled.get("담당부서") ?? null),
    applyStart: apply.start,
    applyEnd: apply.end,
    applyDeadlineAt: apply.deadlineAt,
    announceAt: toIsoDate(announceLine),
    supplyCount: valueAfterLabel(lines, /공급\s*호수/),
  };
}

async function fetchOfficialHtml(url: string) {
  // 수집 단계에서도 허용 호스트만 요청한다(R46, SPEC G1).
  if (!isOfficialNoticeUrl(url)) throw new Error("허용된 공식 호스트가 아닙니다.");
  const response = await fetch(url, {
    headers: NOTICE_REQUEST_HEADERS,
    signal: AbortSignal.timeout(NOTICE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`서울주거포털 HTTP ${response.status}`);
  return response.text();
}

// 한 페이지에 10행이다(실측). 접수 중인 공고는 앞쪽에 모여 있으므로 3페이지면 덮는다.
const PORTAL_PAGE_COUNT = 3;
// 상세는 행마다 한 번 더 요청한다. 우리가 저장한 공고와 겹치는 것만, 그리고 상한을 둔다.
const PORTAL_DETAIL_LIMIT = 12;

/**
 * 목록을 읽고, 우리가 아는 SH 공고와 겹치는 행만 상세까지 따라간다.
 *
 * @param wantedShSeqs 게시판 수집이 만든 SH 공고의 seq. 비우면 상세를 읽지 않는다.
 */
export async function collectPortalSupplements(
  wantedShSeqs: Iterable<string>,
  options: { pageCount?: number; detailLimit?: number } = {},
): Promise<Map<string, PortalSupplement>> {
  const wanted = new Set(wantedShSeqs);
  const pageCount = options.pageCount ?? PORTAL_PAGE_COUNT;
  const detailLimit = options.detailLimit ?? PORTAL_DETAIL_LIMIT;

  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, index) => fetchOfficialHtml(portalListUrl(index + 1))),
  );

  const supplements = new Map<string, PortalSupplement>();
  const pending: { row: PortalListRow; page: number }[] = [];

  pages.forEach((html, index) => {
    for (const row of parsePortalList(html)) {
      if (!row.shSeq || supplements.has(row.shSeq)) continue;
      supplements.set(row.shSeq, { ...row, detail: null, detailUrl: null });
      if (wanted.has(row.shSeq) && row.portalSeq) pending.push({ row, page: index + 1 });
    }
  });

  for (const { row, page } of pending.slice(0, detailLimit)) {
    const url = portalDetailUrl(row.portalSeq as string, page);
    const entry = supplements.get(row.shSeq as string);
    if (!entry) continue;
    try {
      const detail = parsePortalDetail(await fetchOfficialHtml(url));
      // 행 번호로 읽는 상세이므로 제목이 어긋나면 다른 공고다. 그러면 쓰지 않는다.
      const matched = !detail.title || !row.title || detail.title.slice(0, 12) === row.title.slice(0, 12);
      entry.detail = matched ? detail : null;
      entry.detailUrl = matched ? url : null;
    } catch {
      // 상세를 못 읽어도 목록에서 얻은 발표일·모집상태는 남긴다(R43).
      entry.detail = null;
    }
  }

  return supplements;
}
