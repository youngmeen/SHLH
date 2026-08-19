export type NoticeDetail = {
  supply: string | null;
  schedule: string | null;
  rentalTerms: string | null;
  eligibility: string | null;
  documents: string | null;
  caution: string | null;
  competition: {
    status: "published" | "not-published";
    ratio: string | null;
    note: string;
  };
};

const ALLOWED_NOTICE_HOSTS = new Set(["apply.lh.or.kr", "www.i-sh.co.kr", "i-sh.co.kr"]);

export function isAllowedNoticeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_NOTICE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function cleanHtml(html: string) {
  return html
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

function extractSection(text: string, heading: string, nextHeadings: string[]) {
  const start = text.indexOf(heading);
  if (start < 0) return null;
  const candidates = nextHeadings
    .map((candidate) => text.indexOf(candidate, start + heading.length))
    .filter((index) => index > start);
  const end = candidates.length > 0 ? Math.min(...candidates) : Math.min(text.length, start + 900);
  const section = text.slice(start, Math.min(end, start + 900)).trim();
  return section.length > heading.length ? section : null;
}

export function parseNoticeDetailHtml(html: string): NoticeDetail {
  const text = cleanHtml(html);
  const competitionMatch = text.match(/(?:최종\s*)?경쟁률\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*[:：]\s*1/i);
  const ratio = competitionMatch ? `${competitionMatch[1]} : 1` : null;

  return {
    supply: extractSection(text, "공급정보", ["공급일정", "임대기간", "임대조건", "신청자격"]),
    schedule: extractSection(text, "공급일정", ["임대기간", "임대조건", "신청자격", "신청장소"]),
    rentalTerms: extractSection(text, "임대조건", ["지원한도액", "신청자격", "신청장소"]),
    eligibility: extractSection(text, "신청자격", ["안내사항", "신청장소", "제출서류", "주의사항"]),
    documents: extractSection(text, "제출서류", ["신청장소", "안내사항", "주의사항"]),
    caution: extractSection(text, "주의사항", ["관심공고등록", "목록"]),
    competition: {
      status: ratio ? "published" : "not-published",
      ratio,
      note: ratio ? "공식 상세 페이지에 표시된 경쟁률입니다." : "공식 최종 경쟁률이 아직 상세 페이지에 표시되지 않았습니다.",
    },
  };
}
