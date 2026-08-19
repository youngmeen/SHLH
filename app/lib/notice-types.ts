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
