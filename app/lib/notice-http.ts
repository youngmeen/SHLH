// 공식 사이트가 이 클라이언트를 식별하는 값이다. 한쪽만 바꾸면 소스별로
// 다른 클라이언트처럼 보이므로 목록·상세 요청이 같은 상수를 쓴다.
export const NOTICE_REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "User-Agent": "Jibalrim-MVP/0.1 (public-housing-notice-monitor)",
};

export const NOTICE_FETCH_TIMEOUT_MS = 12_000;

/**
 * 수집 단계에서 신뢰하는 공식 호스트.
 *
 * 상세 조회 허용 목록(notice-detail.ts의 ALLOWED_NOTICE_HOSTS)과 목적이 다르다.
 * 그쪽은 "우리가 파싱하는 페이지"만 좁게 열고, 이쪽은 "사용자에게 링크로 보여줘도
 * 되는 공식 출처"를 판별한다. 외부 API가 준 URL을 검증 없이 링크로 렌더하던 문제를
 * 막는다(SPEC G1, R46).
 */
const OFFICIAL_NOTICE_HOSTS = new Set([
  "apply.lh.or.kr",
  "www.myhome.go.kr",
  "myhome.go.kr",
  "www.i-sh.co.kr",
  "i-sh.co.kr",
  "housing.seoul.go.kr",
  "soco.seoul.go.kr",
  "www.data.go.kr",
]);

export function isOfficialNoticeUrl(value: string | undefined | null) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OFFICIAL_NOTICE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
