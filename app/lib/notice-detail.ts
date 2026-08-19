import { stripHtmlToText } from "./html-text.ts";

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

const SECTION_MAX_LENGTH = 900;

function extractSection(text: string, heading: string, nextHeadings: string[]) {
  const start = text.indexOf(heading);
  if (start < 0) return null;
  const candidates = nextHeadings
    .map((candidate) => text.indexOf(candidate, start + heading.length))
    .filter((index) => index > start);
  // 다음 제목까지, 단 900자를 넘기지 않는다. slice가 끝을 알아서 잘라낸다.
  const end = Math.min(start + SECTION_MAX_LENGTH, ...candidates);
  const section = text.slice(start, end).trim();
  return section.length > heading.length ? section : null;
}

export function parseNoticeDetailHtml(html: string): NoticeDetail {
  const text = stripHtmlToText(html);
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
