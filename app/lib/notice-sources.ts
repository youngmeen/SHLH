import { SEOUL_DISTRICTS, shortDistrictName, type District, type NoticeFeed, type PublicNotice, type SourceState } from "./notice-types.ts";
import { stripHtmlToText } from "./html-text.ts";
import { NOTICE_FETCH_TIMEOUT_MS, NOTICE_REQUEST_HEADERS } from "./notice-http.ts";

export const MYHOME_API_URL = "https://apis.data.go.kr/1613000/HWSPR02/rsdtRcritNtcList";
export const MYHOME_INFO_URL = "https://www.data.go.kr/data/15108420/openapi.do";
export const SH_LIST_URL = "https://www.i-sh.co.kr/app/lay2/program/S1T294C297/www/brd/m_247/list.do";

type MyHomeItem = {
  pblancId?: string;
  houseSn?: string | number;
  pblancNm?: string;
  suplyInsttNm?: string;
  houseTyNm?: string;
  suplyTyNm?: string;
  rcritPblancDe?: string;
  url?: string;
  pcUrl?: string;
  brtcNm?: string;
  signguNm?: string;
  beginDe?: string;
  endDe?: string;
  fullAdres?: string;
  suplyHoCo?: string | number;
  przwnerPresnatnDe?: string;
};

type MyHomePayload = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { item?: MyHomeItem | MyHomeItem[]; totalCount?: string | number };
  };
};

function extractCells(row: string) {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtmlToText(match[1]));
}

function formatApiDate(value?: string) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return value;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function inferHousingType(title: string, fallback = "공공임대") {
  const types = ["청년안심주택", "통합공공임대", "신혼희망타운", "행복주택", "장기전세", "국민임대", "영구임대", "매입임대", "전세임대", "공공임대"];
  return types.find((type) => title.includes(type)) ?? fallback;
}

function isRecruitmentPost(title: string) {
  const followUpWords = ["경쟁률", "당첨자", "예비자 발표", "입주대상자", "서류심사", "계약결과", "일정 연기", "접수결과"];
  return title.includes("모집") && !followUpWords.some((word) => title.includes(word));
}

// 수집 범위가 서울 전체이므로 구를 이유로 공고를 버리지 않는다.
// 자치구 필드가 있으면 그 구, 없으면 제목에서 찾고, 못 찾으면 서울 전체로 둔다.
function classifySeoulScope(title: string, signgu = "") {
  if (SEOUL_DISTRICTS.includes(signgu as District)) {
    return { districts: [signgu as District], region: signgu };
  }

  // "강남"과 "강남구"를 같게 본다.
  const mentions = (district: string) => title.includes(district) || title.includes(shortDistrictName(district));

  const mentioned = SEOUL_DISTRICTS.filter(mentions);
  if (mentioned.length > 0) return { districts: mentioned, region: mentioned.join(" · ") };
  return { districts: SEOUL_DISTRICTS, region: "서울 전체 · 상세 공급지역 확인" };
}

function normalizeAgency(name = ""): PublicNotice["agency"] {
  if (name === "LH" || name.includes("한국토지주택")) return "LH";
  if (name === "SH" || name.includes("서울주택도시")) return "SH";
  return "기타";
}

// ICU 포매터 생성은 비싸다. 공고 건수만큼 만들지 않도록 모듈 스코프에 한 번만 둔다.
const SEOUL_DATE_FORMAT = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" });

function seoulToday() {
  return SEOUL_DATE_FORMAT.format(new Date());
}

function inferStatus(begin: string | null, end: string | null, today: string) {
  if (end && end < today) return "접수마감";
  if (begin && begin <= today && (!end || today <= end)) return "접수중";
  return "공고중";
}

export function parseMyHomeNotices(payload: MyHomePayload): PublicNotice[] {
  const header = payload.response?.header;
  if (header?.resultCode !== "00") throw new Error(header?.resultMsg || "마이홈 API 오류");

  const raw = payload.response?.body?.item;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((item) => item.brtcNm === "서울특별시");
  const notices = new Map<string, PublicNotice>();
  const today = seoulToday();

  for (const item of items) {
    const title = item.pblancNm?.trim() || "제목 없는 공고";
    const scope = classifySeoulScope(title, item.signguNm?.trim());
    if (!scope || !item.pblancId) continue;

    const publishedAt = formatApiDate(item.rcritPblancDe) ?? "";
    const applyStart = formatApiDate(item.beginDe);
    const applyEnd = formatApiDate(item.endDe);
    const id = `MYHOME-${item.pblancId}`;
    const existing = notices.get(id);
    if (existing) {
      existing.districts = [...new Set([...existing.districts, ...scope.districts])];
      if (!existing.region.includes(scope.region) && !scope.region.startsWith("서울 전체")) {
        existing.region = existing.districts.join(" · ");
      }
      continue;
    }

    notices.set(id, {
      id,
      agency: normalizeAgency(item.suplyInsttNm),
      title,
      housingType: item.suplyTyNm?.trim() || inferHousingType(title, item.houseTyNm?.trim()),
      region: scope.region,
      districts: scope.districts,
      publishedAt,
      applyStart,
      applyEnd,
      status: inferStatus(applyStart, applyEnd, today),
      department: item.suplyInsttNm?.trim() || null,
      sourceUrl: item.url?.trim() || item.pcUrl?.trim() || MYHOME_INFO_URL,
      supplyCount: String(item.suplyHoCo ?? "").trim() || null,
      winnerAnnouncementDate: formatApiDate(item.przwnerPresnatnDe),
      address: item.fullAdres?.trim() || null,
    });
  }
  return [...notices.values()];
}

export function parseShNotices(html: string): PublicNotice[] {
  const notices: PublicNotice[] = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const detail = row.match(/getDetailView\(['"](\d+)['"]\)/i);
    if (!detail) continue;
    const cells = extractCells(row);
    if (cells.length < 4) continue;

    const title = cells[1];
    const scope = classifySeoulScope(title);
    if (!isRecruitmentPost(title) || !scope) continue;

    const seq = detail[1];
    const params = new URLSearchParams({ multi_itm_seq: "2", seq });
    notices.push({
      id: `SH-${seq}`,
      agency: "SH",
      title,
      housingType: inferHousingType(title),
      region: scope.region,
      districts: scope.districts,
      publishedAt: cells[3] ?? "",
      applyStart: null,
      applyEnd: null,
      status: "원문 확인",
      department: cells[2] || null,
      sourceUrl: `https://www.i-sh.co.kr/app/lay2/program/S1T294C297/www/brd/m_247/view.do?${params}`,
      supplyCount: null,
      winnerAnnouncementDate: null,
      address: null,
    });
  }
  return notices;
}

/**
 * 게시판 여러 페이지의 모집공고를 하나로 합친다. 목록이 밀리면 같은 공고가
 * 다음 페이지에 다시 나타나므로 먼저 본 것을 남긴다(앞 페이지가 더 최신이다).
 */
export function mergeShPages(pageHtmls: string[]): PublicNotice[] {
  const merged = new Map<string, PublicNotice>();
  for (const html of pageHtmls) {
    for (const notice of parseShNotices(html)) {
      if (!merged.has(notice.id)) merged.set(notice.id, notice);
    }
  }
  return [...merged.values()];
}

async function collectMyHome() {
  const key = process.env.MOLIT_MYHOME_API_KEY;
  if (!key) throw new Error("MOLIT_MYHOME_API_KEY가 설정되지 않았습니다.");
  const encodedKey = key.includes("%") ? key : encodeURIComponent(key);
  const url = `${MYHOME_API_URL}?serviceKey=${encodedKey}&pageNo=1&numOfRows=300`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(NOTICE_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`마이홈 HTTP ${response.status}`);
      return parseMyHomeNotices(await response.json() as MyHomePayload);
    } catch (reason) {
      lastError = reason instanceof Error ? reason : new Error("마이홈 수집 실패");
    }
  }
  throw lastError ?? new Error("마이홈 수집 실패");
}

// 한 페이지는 10행이다. 1페이지만 읽으면 아직 접수 중인 공고를 놓치므로
// 여러 페이지를 읽는다. srchWord="모집"은 서버가 제목으로 걸러주는 것이라
// 같은 페이지 수로 훨씬 많은 모집공고를 가져온다(5페이지에 31건).
const SH_LIST_PAGE_COUNT = 5;

async function fetchShPage(page: number) {
  const body = new URLSearchParams({ page: String(page), multi_itm_seq: "2", srchTp: "0", srchWord: "모집" });
  const response = await fetch(SH_LIST_URL, {
    method: "POST",
    // Content-Type은 폼을 POST하는 이 호출에만 필요하다.
    headers: { ...NOTICE_REQUEST_HEADERS, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
    signal: AbortSignal.timeout(NOTICE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`SH HTTP ${response.status}`);
  return response.text();
}

async function collectSh() {
  const pages = await Promise.all(
    Array.from({ length: SH_LIST_PAGE_COUNT }, (_, index) => fetchShPage(index + 1)),
  );
  return mergeShPages(pages);
}

export async function collectNoticeFeed(): Promise<NoticeFeed> {
  const settled = await Promise.allSettled([collectMyHome(), collectSh()]);
  const definitions = [
    { id: "myhome" as const, label: "국토교통부 마이홈", sourceUrl: MYHOME_INFO_URL },
    { id: "sh-board" as const, label: "SH 공식 공고", sourceUrl: SH_LIST_URL },
  ];
  const notices: PublicNotice[] = [];
  const sources: SourceState[] = settled.map((result, index) => {
    const definition = definitions[index];
    if (result.status === "fulfilled") {
      notices.push(...result.value);
      return { ...definition, ok: true, count: result.value.length, message: "공식 데이터 응답 정상" };
    }
    const message = result.reason instanceof Error ? result.reason.message : "수집 실패";
    return { ...definition, ok: false, count: 0, message };
  });

  const uniqueNotices = [...new Map(notices.map((notice) => [notice.id, notice])).values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { notices: uniqueNotices, fetchedAt: new Date().toISOString(), sources };
}
