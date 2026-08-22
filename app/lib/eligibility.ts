import { audienceLabels, extractAudienceType, type AudienceType } from "./audience-match.ts";
import { isValidDateString, type Profile } from "./profile.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 지원 자격 판정 (Phase 3 · R12~R14)
//
// 순수 함수만 둔다 — 화면과 알림 cron이 같은 판정을 써야 한다.
// 판정 성향(R14): 미충족은 프로필이 명백히 어긋날 때만 준다. 정보가 없으면
// 언제나 `확인 필요`다. 공고를 놓치는 것보다 사용자가 한 번 더 확인하는
// 방향을 우선한다.
// ─────────────────────────────────────────────────────────────────────────────

export type EligibilityStatus = "met" | "unmet" | "review";

export type EligibilityItem = {
  key: "age" | "homeless" | "marital" | "income" | "assets" | "car" | "residence" | "household" | "subscription" | "welfare";
  label: string;
  status: EligibilityStatus;
  /** 판정 근거(R13). 원문에서 읽은 기준은 문구를 그대로 인용한다. */
  basis: string;
};

export type EligibilityVerdict = "eligible" | "ineligible" | "review";

export type EligibilityResult = {
  audience: AudienceType;
  audienceLabel: string;
  verdict: EligibilityVerdict;
  verdictLabel: string;
  items: EligibilityItem[];
};

// ─── 만 나이 ─────────────────────────────────────────────────────────────────

/** 기준일 현재 만 나이. 판정 기준일은 공고일이다(R12). 읽을 수 없으면 null. */
export function ageOnDate(birthDate: string, referenceDate: string): number | null {
  if (!isValidDateString(birthDate) || !isValidDateString(referenceDate)) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ry, rm, rd] = referenceDate.split("-").map(Number);
  // 생일이 아직 안 지났으면 한 살을 뺀다. 2월 29일생은 평년에 (2,29)>(2,28)이라
  // 2월 말까지는 생일 전으로, 3월 1일부터 생일 후로 계산된다.
  const beforeBirthday = rm < bm || (rm === bm && rd < bd);
  return ry - by - (beforeBirthday ? 1 : 0);
}

// ─── 원문 문구 파싱 ──────────────────────────────────────────────────────────

/** "3억 6,100만원" → 36100. 만원 단위. 읽을 수 없으면 null. */
export function parseAmountToManwon(text: string): number | null {
  const normalized = text.replaceAll(",", "");
  const match = normalized.match(/(?:([0-9]+)\s*억)?\s*(?:([0-9]+)\s*만\s*원|([0-9]+)\s*만(?!\S*원)|(?<![0-9])원)?/);
  const eok = match?.[1] ? Number(match[1]) : 0;
  const man = match?.[2] ?? match?.[3];
  if (eok === 0 && !man) return null;
  return eok * 10000 + (man ? Number(man) : 0);
}

type Quoted<T> = T & { quote: string };

export type ParsedEligibilityText = {
  ageRange: Quoted<{ min: number; max: number }> | null;
  incomePercent: Quoted<{ percent: number }> | null;
  assetLimitManwon: Quoted<{ amount: number }> | null;
  carLimitManwon: Quoted<{ amount: number }> | null;
  requiresSubscription: { quote: string } | null;
};

/** 키워드 뒤 일정 범위에서 금액 문구를 찾는다. "총자산가액 36,100만원 이하" 류. */
function amountAfter(text: string, keyword: RegExp): Quoted<{ amount: number }> | null {
  const match = text.match(keyword);
  if (!match || match.index === undefined) return null;
  const window = text.slice(match.index, match.index + match[0].length + 40);
  const amountMatch = window.match(/([0-9]+\s*억)?\s*[0-9,]*[0-9]\s*만\s*원|[0-9]+\s*억\s*원/);
  if (!amountMatch) return null;
  const amount = parseAmountToManwon(amountMatch[0]);
  if (amount === null || amount <= 0) return null;
  return { amount, quote: window.slice(0, window.indexOf(amountMatch[0]) + amountMatch[0].length).trim() };
}

/**
 * LH 상세에서 추출한 신청자격 구간 텍스트(notice-detail.ts)에서 판정에 쓸 수
 * 있는 기준을 읽는다. 못 읽은 것은 null — 없다고 단정하는 것이 아니라
 * "원문 확인"으로 남기기 위한 신호다(R14).
 */
export function parseEligibilityText(text: string | null): ParsedEligibilityText {
  if (!text) return { ageRange: null, incomePercent: null, assetLimitManwon: null, carLimitManwon: null, requiresSubscription: null };

  const ageMatch = text.match(/만\s*([0-9]{1,2})\s*세\s*이상\s*(?:~\s*)?(?:만\s*)?([0-9]{1,2})\s*세\s*이하/);
  const incomeMatch = text.match(/(?:도시근로자|전년도)[^%]{0,60}?([0-9]{2,3})\s*%/);

  return {
    ageRange: ageMatch ? { min: Number(ageMatch[1]), max: Number(ageMatch[2]), quote: ageMatch[0] } : null,
    incomePercent: incomeMatch ? { percent: Number(incomeMatch[1]), quote: incomeMatch[0].trim() } : null,
    assetLimitManwon: amountAfter(text, /총\s*자산(?:가액)?/),
    carLimitManwon: amountAfter(text, /자동차\s*(?:가액)?/),
    requiresSubscription: (() => {
      const match = text.match(/(?:주택청약종합저축|청약\s*저축|청약\s*통장)[^.。]{0,30}/);
      return match ? { quote: match[0].trim() } : null;
    })(),
  };
}

// ─── 판정 ────────────────────────────────────────────────────────────────────

const item = (key: EligibilityItem["key"], label: string, status: EligibilityStatus, basis: string): EligibilityItem => ({ key, label, status, basis });

const residenceLabels: Record<Profile["residence"], string> = { seoul: "서울", capital: "수도권(서울 외)", other: "그 외 지역" };
const welfareLabels: Record<Profile["welfare"], string> = { none: "해당 없음", recipient: "수급자", "near-poor": "차상위" };

/** 대상 계층별 일반 연령 규칙. 공고별 예외가 있으므로 근거에 원문 확인을 항상 붙인다. */
const generalAgeRules: Partial<Record<AudienceType, { min: number; max: number; note: string }>> = {
  youth: { min: 19, max: 39, note: "일반 기준 19~39세" },
  senior: { min: 65, max: 200, note: "일반 기준 만 65세 이상" },
};

export function evaluateEligibility(
  profile: Profile,
  notice: { title: string; publishedAt: string },
  eligibilityText: string | null,
): EligibilityResult {
  const audience = extractAudienceType(notice.title);
  const parsed = parseEligibilityText(eligibilityText);

  // 판정 기준일 = 공고일. 공고일을 못 읽으면 오늘로 계산하되 근거에 밝힌다.
  const reference = isValidDateString(notice.publishedAt) ? notice.publishedAt : new Date().toISOString().slice(0, 10);
  const referenceNote = isValidDateString(notice.publishedAt) ? `공고일 ${notice.publishedAt} 기준` : "공고일 미상 · 오늘 기준";
  const computedAge = ageOnDate(profile.birthDate, reference);
  const age = computedAge ?? profile.age;
  const ageSource = computedAge === null ? "생년월일 미입력 · 저장된 나이 사용" : referenceNote;

  const items: EligibilityItem[] = [];

  // 연령 — 원문 범위가 최우선, 없으면 계층별 일반 규칙, 그것도 없으면 확인 필요.
  if (parsed.ageRange) {
    const inRange = age >= parsed.ageRange.min && age <= parsed.ageRange.max;
    items.push(item("age", "연령", inRange ? "met" : "unmet",
      `만 ${age}세(${ageSource}) · 원문 "${parsed.ageRange.quote}"${inRange ? "" : " — 예외 기준은 원문에서 확인"}`));
  } else if (generalAgeRules[audience]) {
    const rule = generalAgeRules[audience]!;
    const inRange = age >= rule.min && age <= rule.max;
    items.push(item("age", "연령", inRange ? "met" : "unmet",
      `만 ${age}세(${ageSource}) · ${rule.note} — 공고별 예외는 원문 확인`));
  } else {
    items.push(item("age", "연령", "review", `만 ${age}세(${ageSource}) · 원문에서 연령 조건 확인`));
  }

  // 무주택 — 공공임대의 공통 전제. 보유 입력만 명백한 미충족이다.
  items.push(profile.hasHouse
    ? item("homeless", "무주택", "unmet", "주택 보유로 입력 — 무주택 세대구성원 요건을 충족하지 못할 가능성이 큼 · 원문 확인")
    : item("homeless", "무주택", "met", "무주택으로 입력 · 세대구성원 범위는 원문 확인"));

  // 혼인·가구 — 계층별로 명백한 어긋남만 미충족.
  const maritalLabel = { single: "미혼", married: "기혼", prospective: "예비부부" }[profile.maritalStatus];
  if (audience === "newlywed") {
    const related = profile.maritalStatus !== "single" || profile.children > 0 || profile.isPregnant || profile.isSingleParent;
    items.push(item("marital", "혼인·가구", related ? "met" : "unmet",
      related ? `${maritalLabel} 입력 · 혼인기간과 자녀 연령은 원문 확인` : `${maritalLabel}·무자녀 입력 — 신혼·신생아 대상과 어긋남`));
  } else if (audience === "youth") {
    items.push(item("marital", "혼인·가구", profile.maritalStatus === "single" ? "met" : "review",
      profile.maritalStatus === "single" ? "미혼 입력 · 청년 계층의 일반 요건과 일치" : `${maritalLabel} 입력 — 청년 계층의 미혼 요건은 원문 확인`));
  } else if (audience === "single-parent") {
    items.push(item("marital", "혼인·가구", profile.isSingleParent ? "met" : "unmet",
      profile.isSingleParent ? "한부모 가구 입력 · 보호대상 여부는 원문 확인" : "한부모 가구로 입력되지 않음"));
  } else if (audience === "multichild") {
    const status: EligibilityStatus = profile.children >= 2 ? "met" : profile.children === 1 || profile.isPregnant ? "review" : "unmet";
    items.push(item("marital", "혼인·가구", status, `자녀 ${profile.children}명${profile.isPregnant ? " · 임신 중" : ""} 입력 · 태아 포함 여부는 원문 확인`));
  } else {
    items.push(item("marital", "혼인·가구", "review", `${maritalLabel} · ${profile.householdSize}인 가구 입력 · 원문에서 대상 계층 확인`));
  }

  // 소득 — 기준표(가구원수별 금액)는 공고문 PDF에만 있으므로 %는 환산하지 않는다.
  items.push(parsed.incomePercent
    ? item("income", "소득", "review", `원문 "${parsed.incomePercent.quote}" — 가구원수별 금액 기준표는 공고문 확인 · 입력 ${profile.monthlyIncome.toLocaleString()}만원`)
    : item("income", "소득", "review", `입력 ${profile.monthlyIncome.toLocaleString()}만원 · 원문에서 소득 기준 확인`));

  // 자산·자동차 — 원문에 금액이 있으면 입력값과 비교한다.
  if (parsed.assetLimitManwon) {
    const within = profile.totalAssets <= parsed.assetLimitManwon.amount;
    items.push(item("assets", "총자산", within ? "met" : "unmet",
      `입력 ${profile.totalAssets.toLocaleString()}만원 · 원문 "${parsed.assetLimitManwon.quote}"`));
  } else {
    items.push(item("assets", "총자산", "review", `입력 ${profile.totalAssets.toLocaleString()}만원 · 원문에서 자산 기준 확인`));
  }
  if (parsed.carLimitManwon) {
    const within = profile.carValue <= parsed.carLimitManwon.amount;
    items.push(item("car", "자동차", within ? "met" : "unmet",
      `${profile.carValue === 0 ? "자동차 없음" : `입력 ${profile.carValue.toLocaleString()}만원`} · 원문 "${parsed.carLimitManwon.quote}"`));
  } else {
    items.push(item("car", "자동차", "review", `${profile.carValue === 0 ? "자동차 없음 입력" : `입력 ${profile.carValue.toLocaleString()}만원`} · 원문에서 가액 기준 확인`));
  }

  // 거주·세대 — 원문 자동 판독이 안 되는 항목. 입력을 보여주고 원문 확인으로 남긴다.
  items.push(item("residence", "거주지", "review", `${residenceLabels[profile.residence]} 거주 입력 · 원문에서 거주 요건 확인`));
  items.push(item("household", "세대", "review", `${profile.householdSize}인 가구 입력 · 세대구성원 범위·중복 신청 제한은 원문 확인`));

  // 청약통장 — 미보유는 접수 전 가입이 가능하므로 미충족이 아니다.
  if (parsed.requiresSubscription) {
    items.push(profile.hasSubscriptionAccount
      ? item("subscription", "청약통장", "met", `보유 · 납입 ${profile.subscriptionPaymentCount}회 입력 · 원문 "${parsed.requiresSubscription.quote}" — 회차 요건 확인`)
      : item("subscription", "청약통장", "review", `원문 "${parsed.requiresSubscription.quote}" · 미보유 입력 — 접수 전 가입 가능 여부 확인`));
  } else {
    items.push(item("subscription", "청약통장", "review",
      `${profile.hasSubscriptionAccount ? `보유 · 납입 ${profile.subscriptionPaymentCount}회` : "미보유"} 입력 · 원문에서 통장 요건 확인`));
  }

  // 복지자격 — 요건이 아니라 순위 우대 입력이다. 원문 대조 전에는 확정하지 않는다.
  items.push(item("welfare", "복지자격", "review", `${welfareLabels[profile.welfare]} 입력 · 1순위 자격과 증빙은 원문 확인`));

  // 전체 판정. ROADMAP 완료 조건 예시대로, 핵심(연령·무주택·혼인)이 충족이고
  // 미충족이 없으면 확인 필요 항목이 남아 있어도 `지원 가능`이다.
  const has = (status: EligibilityStatus) => items.some((entry) => entry.status === status);
  const core = ["age", "homeless", "marital"] as const;
  const coreMet = core.every((key) => items.find((entry) => entry.key === key)?.status === "met");

  const verdict: EligibilityVerdict = has("unmet") ? "ineligible" : coreMet ? "eligible" : "review";
  const verdictLabel = {
    eligible: "지원 가능 — 확인 필요 항목은 원문에서",
    ineligible: "현재 조건으로 비추천 — 예외 기준은 원문에서",
    review: "확인 필요 — 원문의 신청 자격 대조",
  }[verdict];

  return { audience, audienceLabel: audienceLabels[audience], verdict, verdictLabel, items };
}
