export type District =
  | "강남구" | "강동구" | "강북구" | "강서구" | "관악구"
  | "광진구" | "구로구" | "금천구" | "노원구" | "도봉구"
  | "동대문구" | "동작구" | "마포구" | "서대문구" | "서초구"
  | "성동구" | "성북구" | "송파구" | "양천구" | "영등포구"
  | "용산구" | "은평구" | "종로구" | "중구" | "중랑구";

// 수집 대상은 서울 전체다. 수집 필터(notice-sources)와 프로필 기본값(page)이
// 같은 목록을 봐야 하므로 여기서만 정의한다.
export const SEOUL_DISTRICTS: District[] = [
  "강남구", "강동구", "강북구", "강서구", "관악구",
  "광진구", "구로구", "금천구", "노원구", "도봉구",
  "동대문구", "동작구", "마포구", "서대문구", "서초구",
  "성동구", "성북구", "송파구", "양천구", "영등포구",
  "용산구", "은평구", "종로구", "중구", "중랑구",
];

/**
 * "강남구" → "강남". 공고 제목 매칭과 칩 라벨이 같은 규칙을 쓴다.
 *
 * 끝의 "구"만 떼고, 한 글자로 줄어들면 약칭을 만들지 않는다. "중구"를 "중"으로
 * 줄이면 "모집 중" 같은 제목이 모두 중구로 잡히고, "구로구"에서 앞의 "구"를
 * 떼면 "로구"가 되어 "구로"로 시작하는 제목을 놓친다.
 */
export function shortDistrictName(district: string) {
  const short = district.replace(/구$/, "");
  return short.length >= 2 ? short : district;
}

export type PublicNotice = {
  id: string;
  agency: "LH" | "SH" | "기타";
  title: string;
  housingType: string;
  region: string;
  districts: District[];
  publishedAt: string;
  applyStart: string | null;
  applyEnd: string | null;
  status: string;
  department: string | null;
  sourceUrl: string;
  supplyCount: string | null;
  winnerAnnouncementDate: string | null;
  address: string | null;
};

export type SourceState = {
  id: "myhome" | "sh-board";
  label: string;
  ok: boolean;
  count: number;
  message: string;
  sourceUrl: string;
};

export type NoticeFeed = {
  notices: PublicNotice[];
  fetchedAt: string;
  sources: SourceState[];
};

// ─────────────────────────────────────────────────────────────────────────────
// 저장용 타입 (Phase 2)
//
// 화면이 쓰는 PublicNotice는 목록 표시에 맞춰 공고 단위로 눌러 담은 형태다.
// 저장은 그것과 다르다 — 공고 한 건의 여러 주택 행을 잃지 않아야 하고(SPEC G10),
// 후속공고도 버리지 않아야 하며(G3), 값의 출처를 함께 남겨야 한다(R42).
// 그래서 화면 타입을 고치지 않고 저장용 타입을 따로 둔다.
// 칼럼 구성은 db/schema.ts와 짝을 맞춘다.
// ─────────────────────────────────────────────────────────────────────────────

export type ValueSource = "official" | "calculated" | "inferred" | "unknown";

export type NoticeSource = "myhome" | "sh-board";

export type HousingUnitSource = "myhome-notice" | "myhome-complex" | "lh-complex" | "soco-youth";

export type StoredNotice = {
  source: NoticeSource;
  sourceId: string;
  title: string;
  agency: PublicNotice["agency"];
  instName: string | null;
  /** 출처가 준 유형 표기를 그대로 둔다. 정규화 값은 저장 단계에서 따로 채운다. */
  noticeType: string | null;
  region: string | null;
  districts: District[];
  publishedAt: string | null;
  applyStart: string | null;
  applyEnd: string | null;
  announceAt: string | null;
  /** 출처 표기 그대로 — `일반공고` `정정공고` `모집중` 등. */
  status: string | null;
  supplyCount: string | null;
  sourceUrl: string;
  /** 정정공고가 가리키는 원 공고 식별자. */
  beforeSourceId: string | null;
  raw: unknown;
};

export type StoredHousingUnit = {
  source: HousingUnitSource;
  sourceKey: string;
  /** 어느 공고에서 나온 주택인지. 재고에서 온 행은 null이다. */
  noticeSourceId: string | null;
  instName: string | null;
  sido: string | null;
  sigungu: string | null;
  complexName: string | null;
  address: string | null;
  pnu: string | null;
  unitNo: string | null;
  supplyType: string | null;
  houseType: string | null;
  exclusiveArea: number | null;
  commonArea: number | null;
  householdCount: number | null;
  totalHousehold: number | null;
  deposit: number | null;
  monthlyRent: number | null;
  heating: string | null;
  parkingCount: number | null;
  builtOn: string | null;
  valueSource: ValueSource;
};

export type FollowUpKind = "결과발표" | "당첨자" | "입주대상자" | "정정" | "기타";

export type StoredFollowUp = {
  source: NoticeSource;
  sourceId: string;
  title: string;
  kind: FollowUpKind;
  publishedAt: string | null;
  sourceUrl: string;
  /** 원 모집공고를 가리키는 식별자를 알아낸 경우. */
  relatedSourceId: string | null;
  raw: unknown;
};

/**
 * 자치구 → 시군구 코드(법정동코드의 시도 뒤 3자리).
 *
 * 마이홈 단지정보 API는 `brtcCode`(시도 2자리)와 `signguCode`(3자리)를 **둘 다**
 * 요구한다. 하나만 주면 파라미터 오류, 5자리 코드를 주면 데이터가 없다고 답한다
 * (SPEC 5절 실측).
 */
export const SEOUL_BRTC_CODE = "11";

export const SEOUL_SIGUNGU_CODE: Record<District, string> = {
  종로구: "110",
  중구: "140",
  용산구: "170",
  성동구: "200",
  광진구: "215",
  동대문구: "230",
  중랑구: "260",
  성북구: "290",
  강북구: "305",
  도봉구: "320",
  노원구: "350",
  은평구: "380",
  서대문구: "410",
  마포구: "440",
  양천구: "470",
  강서구: "500",
  구로구: "530",
  금천구: "545",
  영등포구: "560",
  동작구: "590",
  관악구: "620",
  서초구: "650",
  강남구: "680",
  송파구: "710",
  강동구: "740",
};
