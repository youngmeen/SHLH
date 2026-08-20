// 공식 공고 HTML을 신뢰 가능한 평문으로 바꾸는 단일 경로.
// 목록 파서(notice-sources)와 상세 파서(notice-detail)가 같은 결과를 내야 하므로
// 이 함수만 수정한다. 엔티티 치환 순서가 결과를 바꾸니 순서를 유지할 것
// (`&amp;lt;`가 `<`까지 풀리는 것은 의도된 동작이다).

function removeMarkup(value: string) {
  return value
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&middot;/gi, "·")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function stripHtmlToText(value: string) {
  return decodeEntities(removeMarkup(value)).replace(/\s+/g, " ").trim();
}

// 문단·줄바꿈 태그. 서울주거포털 상세 본문은 `■ 접수기간 : …`처럼 한 줄이 한 항목이라
// 줄을 잃으면 항목 경계가 사라진다(공급호수 뒤의 문장이 접수기간에 붙는다).
const LINE_BOUNDARY = /<br\s*\/?>|<\/(?:p|div|tr|li|td|th|h[1-6])\s*>/gi;

/** 블록 경계를 줄바꿈으로 살려서 줄 단위 평문으로 바꾼다. 빈 줄은 버린다. */
export function htmlToLines(value: string) {
  return decodeEntities(removeMarkup(value.replace(LINE_BOUNDARY, "\n")))
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line !== "");
}
