// 공식 사이트가 이 클라이언트를 식별하는 값이다. 한쪽만 바꾸면 소스별로
// 다른 클라이언트처럼 보이므로 목록·상세 요청이 같은 상수를 쓴다.
export const NOTICE_REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "User-Agent": "Jibalrim-MVP/0.1 (public-housing-notice-monitor)",
};

export const NOTICE_FETCH_TIMEOUT_MS = 12_000;
