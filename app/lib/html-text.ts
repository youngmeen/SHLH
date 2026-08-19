// 공식 공고 HTML을 신뢰 가능한 평문으로 바꾸는 단일 경로.
// 목록 파서(notice-sources)와 상세 파서(notice-detail)가 같은 결과를 내야 하므로
// 이 함수만 수정한다. 엔티티 치환 순서가 결과를 바꾸니 순서를 유지할 것
// (`&amp;lt;`가 `<`까지 풀리는 것은 의도된 동작이다).
export function stripHtmlToText(value: string) {
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
