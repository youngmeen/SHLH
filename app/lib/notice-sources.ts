import {
  SEOUL_DISTRICTS,
  shortDistrictName,
  type District,
  type NoticeFeed,
  type PublicNotice,
  type SourceState,
  type FollowUpKind,
  type StoredFollowUp,
  type StoredHousingUnit,
  type StoredNotice,
} from "./notice-types.ts";
import { stripHtmlToText } from "./html-text.ts";
import { NOTICE_FETCH_TIMEOUT_MS, NOTICE_REQUEST_HEADERS, isOfficialNoticeUrl } from "./notice-http.ts";

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
  // 아래는 응답에 있는데 지금까지 읽지 않던 값이다(SPEC 5절 실측).
  // 한 공고가 주택 단위로 여러 행 오고, 이 필드들이 행마다 다르다.
  hsmpNm?: string;
  pnu?: string;
  sumSuplyCo?: string | number;
  totHshldCo?: string | number;
  rentGtn?: string | number;
  mtRntchrg?: string | number;
  heatMthdNm?: string;
  sttusNm?: string;
  beforePblancId?: string;
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
  // 공공데이터포털은 계정 인증키 하나로 승인된 모든 API를 호출한다. 마이홈 모집공고와
  // 단지정보, LH API가 같은 키를 쓰므로 기관 이름을 딴 옛 변수명은 fallback으로만 남긴다.
  const key = process.env.DATA_GO_KR_API_KEY ?? process.env.MOLIT_MYHOME_API_KEY;
  if (!key) throw new Error("DATA_GO_KR_API_KEY가 설정되지 않았습니다.");
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

// ─────────────────────────────────────────────────────────────────────────────
// 저장용 추출 (Phase 2)
//
// 위의 parseMyHomeNotices는 화면 목록용이라 한 공고를 한 줄로 눌러 담는다.
// 저장은 그럴 수 없다. 마이홈 API는 한 공고를 주택 단위 여러 행으로 주고
// (구리·남양주 행복주택 공고 = 4행, 각 행이 다른 단지) 지금까지 그 행들을
// 버리고 있었다(SPEC G10). 아래 함수가 공고와 주택을 나눠서 돌려준다.
// ─────────────────────────────────────────────────────────────────────────────

function text(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** "5,700호" 같은 표기가 섞여 있으므로 숫자만 남겨 읽는다. 0과 빈 값은 구분한다. */
function count(value: unknown) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const digits = raw.replace(/[^\d.-]/g, "");
  if (digits === "") return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 외부 API가 준 링크를 검증한다. 공식 호스트가 아니면 안내 페이지로 돌린다(G1). */
function officialUrl(...candidates: (string | undefined)[]) {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (isOfficialNoticeUrl(value)) return value as string;
  }
  return MYHOME_INFO_URL;
}

export type MyHomeRecords = { notices: StoredNotice[]; units: StoredHousingUnit[] };

export function extractMyHomeRecords(payload: MyHomePayload, region = "서울특별시"): MyHomeRecords {
  const header = payload.response?.header;
  if (header?.resultCode !== "00") throw new Error(header?.resultMsg || "마이홈 API 오류");

  const raw = payload.response?.body?.item;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
    (item) => item.pblancId && (!region || item.brtcNm === region),
  );

  const notices = new Map<string, StoredNotice>();
  const units: StoredHousingUnit[] = [];

  for (const item of items) {
    const sourceId = String(item.pblancId);
    const title = item.pblancNm?.trim() || "제목 없는 공고";
    const scope = classifySeoulScope(title, item.signguNm?.trim());

    const existing = notices.get(sourceId);
    if (existing) {
      // 같은 공고의 다른 행. 자치구만 합치고 나머지는 첫 행을 유지한다.
      existing.districts = [...new Set([...existing.districts, ...scope.districts])];
    } else {
      notices.set(sourceId, {
        source: "myhome",
        sourceId,
        title,
        agency: normalizeAgency(item.suplyInsttNm),
        instName: text(item.suplyInsttNm),
        noticeType: text(item.suplyTyNm) ?? text(item.houseTyNm),
        region: scope.region,
        districts: scope.districts,
        publishedAt: formatApiDate(item.rcritPblancDe),
        applyStart: formatApiDate(item.beginDe),
        applyEnd: formatApiDate(item.endDe),
        announceAt: formatApiDate(item.przwnerPresnatnDe),
        status: text(item.sttusNm),
        supplyCount: text(item.suplyHoCo),
        sourceUrl: officialUrl(item.url, item.pcUrl),
        beforeSourceId: text(item.beforePblancId),
        raw: item,
      });
    }

    // 주택 정보가 없는 행(전세임대 등)은 주택으로 만들지 않는다. 공고 시점에
    // 공급주택이 존재하지 않는 유형이므로 만들면 없는 주택을 만드는 셈이다(R44).
    const complexName = text(item.hsmpNm);
    const address = text(item.fullAdres);
    if (!complexName && !address) continue;

    units.push({
      source: "myhome-notice",
      sourceKey: `${sourceId}:${text(item.houseSn) ?? "0"}`,
      noticeSourceId: sourceId,
      instName: text(item.suplyInsttNm),
      sido: text(item.brtcNm),
      sigungu: text(item.signguNm),
      complexName,
      address,
      pnu: text(item.pnu),
      unitNo: null, // 모집공고 API는 호수를 주지 않는다. 재고 API에서 채운다
      supplyType: text(item.suplyTyNm),
      houseType: text(item.houseTyNm),
      exclusiveArea: null, // 이 API에는 면적 필드가 없다(실측). 단지정보 API에서 온다
      commonArea: null,
      householdCount: count(item.sumSuplyCo),
      totalHousehold: count(item.totHshldCo),
      deposit: count(item.rentGtn),
      monthlyRent: count(item.mtRntchrg),
      heating: text(item.heatMthdNm),
      parkingCount: null,
      builtOn: null,
      valueSource: "official",
    });
  }

  return { notices: [...notices.values()], units };
}

// ─────────────────────────────────────────────────────────────────────────────
// SH 게시판 저장용 추출
//
// 화면용 parseShNotices는 후속공고를 버린다. 저장은 버릴 수 없다 — 결과·당첨자
// 발표가 과거 경쟁률의 유일한 출처이기 때문이다(SPEC G3, Phase 6 선행 조건).
// 실측에서 확인한 두 가지도 함께 처리한다.
//  · `[정정]…모집공고`가 모집공고에 섞여 들어온다(G4). 정정은 버릴 것이 아니라
//    "내용이 바뀐 모집공고"이므로 공고로 유지하고 상태에 표시한다.
//  · 목록 제목에 게시판 뱃지가 붙는다 — `NEW [청년형] …`(G6).
// ─────────────────────────────────────────────────────────────────────────────

/** 게시판이 제목 앞에 붙이는 뱃지를 떼어낸다. 제목으로 신규·중복·유형을 판단하므로 남기면 안 된다. */
export function cleanBoardTitle(title: string) {
  return title.replace(/^(?:NEW|new|N)\s+/, "").trim();
}

const FOLLOW_UP_RULES: [RegExp, FollowUpKind][] = [
  [/당첨자/, "당첨자"],
  [/예비자\s*발표|입주대상자|예비\s*\d+차/, "입주대상자"],
  [/경쟁률|접수결과/, "결과발표"],
  [/서류심사|계약결과|계약\s*안내|일정\s*연기/, "기타"],
];

/**
 * 게시판 한 행의 성격을 가른다.
 *
 * `recruitment`  모집공고로 저장한다 (정정 포함)
 * `follow-up`    후속공고로 보관한다 (경쟁률 소스)
 * `unknown`      모집인지 확신할 수 없다. 버리지 않고 후속공고 `기타`로 보관한다(R3)
 */
export function classifyShRow(rawTitle: string): { kind: "recruitment" | "follow-up" | "unknown"; followUpKind: FollowUpKind | null; corrected: boolean } {
  const title = cleanBoardTitle(rawTitle);
  const corrected = /\[?정정\]?/.test(title) || title.includes("(수정)") || title.startsWith("(수정)");

  for (const [pattern, followUpKind] of FOLLOW_UP_RULES) {
    if (pattern.test(title)) return { kind: "follow-up", followUpKind, corrected };
  }
  if (corrected && title.includes("모집")) return { kind: "recruitment", followUpKind: null, corrected: true };
  if (title.includes("모집")) return { kind: "recruitment", followUpKind: null, corrected: false };
  return { kind: "unknown", followUpKind: "기타", corrected };
}

export type ShRecords = { notices: StoredNotice[]; followUps: StoredFollowUp[] };

/** 게시판 여러 페이지에서 공고와 후속공고를 함께 뽑는다. 먼저 본 행을 남긴다. */
export function extractShRecords(pageHtmls: string[]): ShRecords {
  const notices = new Map<string, StoredNotice>();
  const followUps = new Map<string, StoredFollowUp>();

  for (const html of pageHtmls) {
    for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const row = match[1];
      const detail = row.match(/getDetailView\(['"](\d+)['"]\)/i);
      if (!detail) continue;
      const cells = extractCells(row);
      if (cells.length < 4) continue;

      const sourceId = detail[1];
      if (notices.has(sourceId) || followUps.has(sourceId)) continue;

      const title = cleanBoardTitle(cells[1] ?? "");
      if (!title) continue;
      const publishedAt = cells[3] || null;
      const department = cells[2] || null;
      const params = new URLSearchParams({ multi_itm_seq: "2", seq: sourceId });
      const sourceUrl = `https://www.i-sh.co.kr/app/lay2/program/S1T294C297/www/brd/m_247/view.do?${params}`;
      const raw = { seq: sourceId, cells, department };
      const verdict = classifyShRow(cells[1] ?? "");

      if (verdict.kind === "recruitment") {
        const scope = classifySeoulScope(title);
        notices.set(sourceId, {
          source: "sh-board",
          sourceId,
          title,
          agency: "SH",
          instName: "서울주택도시개발공사",
          noticeType: inferHousingType(title),
          region: scope.region,
          districts: scope.districts,
          publishedAt,
          // 접수기간·발표일은 게시판이 주지 않는다. 서울주거포털에서 채운다.
          applyStart: null,
          applyEnd: null,
          announceAt: null,
          status: verdict.corrected ? "정정공고" : null,
          supplyCount: null,
          sourceUrl,
          beforeSourceId: null,
          raw,
        });
        continue;
      }

      followUps.set(sourceId, {
        source: "sh-board",
        sourceId,
        title,
        kind: verdict.followUpKind ?? "기타",
        publishedAt,
        sourceUrl,
        relatedSourceId: null,
        raw,
      });
    }
  }

  return { notices: [...notices.values()], followUps: [...followUps.values()] };
}
