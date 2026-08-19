import type { District, NoticeFeed, PublicNotice, SourceState } from "./notice-types";

export const MYHOME_API_URL = "https://apis.data.go.kr/1613000/HWSPR02/rsdtRcritNtcList";
export const MYHOME_INFO_URL = "https://www.data.go.kr/data/15108420/openapi.do";
export const SH_LIST_URL = "https://www.i-sh.co.kr/app/lay2/program/S1T294C297/www/brd/m_247/list.do";

const TARGET_DISTRICTS: District[] = ["서초구", "강남구", "송파구"];
const SEOUL_DISTRICTS = [
  "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구",
  "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구",
  "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구",
];

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

const REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
  "User-Agent": "Jibalrim-MVP/0.1 (public-housing-notice-monitor)",
};

function cleanText(value: string) {
  return value
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&middot;/gi, "·")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCells(row: string) {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cleanText(match[1]));
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
  const followUpWords = ["경쟁률", "당첨자", "예비자 발표", "서류심사", "계약결과", "일정 연기", "접수결과"];
  return title.includes("모집") && !followUpWords.some((word) => title.includes(word));
}

function classifySeoulScope(title: string, signgu = "") {
  if (TARGET_DISTRICTS.includes(signgu as District)) {
    return { districts: [signgu as District], region: signgu };
  }
  if (signgu && SEOUL_DISTRICTS.includes(signgu)) return null;

  const targets = TARGET_DISTRICTS.filter((district) => title.includes(district) || title.includes(district.replace("구", "")));
  const mentionsOtherDistrict = SEOUL_DISTRICTS.some(
    (district) => !TARGET_DISTRICTS.includes(district as District) && (title.includes(district) || title.includes(district.replace("구", ""))),
  );
  if (targets.length > 0) return { districts: targets, region: targets.join(" · ") };
  if (mentionsOtherDistrict) return null;
  return { districts: TARGET_DISTRICTS, region: "서울 전체 · 상세 공급지역 확인" };
}

function normalizeAgency(name = ""): PublicNotice["agency"] {
  if (name === "LH" || name.includes("한국토지주택")) return "LH";
  if (name === "SH" || name.includes("서울주택도시")) return "SH";
  return "기타";
}

function inferStatus(begin: string | null, end: string | null) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
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
      status: inferStatus(applyStart, applyEnd),
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
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`마이홈 HTTP ${response.status}`);
      return parseMyHomeNotices(await response.json() as MyHomePayload);
    } catch (reason) {
      lastError = reason instanceof Error ? reason : new Error("마이홈 수집 실패");
    }
  }
  throw lastError ?? new Error("마이홈 수집 실패");
}

async function collectSh() {
  const body = new URLSearchParams({ page: "1", multi_itm_seq: "2", srchTp: "0", srchWord: "모집" });
  const response = await fetch(SH_LIST_URL, {
    method: "POST",
    headers: REQUEST_HEADERS,
    body: body.toString(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`SH HTTP ${response.status}`);
  return parseShNotices(await response.text());
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
