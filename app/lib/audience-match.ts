export type MaritalStatus = "single" | "married" | "prospective";

export type HousingProfile = {
  age: number;
  hasHouse: boolean;
  maritalStatus: MaritalStatus;
  children: number;
  isPregnant: boolean;
  isSingleParent: boolean;
};

export type AudienceStatus = "likely" | "review" | "mismatch";

export type AudienceResult = {
  status: AudienceStatus;
  label: string;
  detail: string;
};

/**
 * 공고 제목이 가리키는 대상 계층. 제목 기반 1차 분류(evaluateAudience)와
 * 자격 판정(eligibility.ts)이 같은 추출을 쓴다 — 같은 기능을 두 곳에 두지
 * 않는다(ROADMAP Phase 3).
 */
export type AudienceType = "youth" | "newlywed" | "multichild" | "senior" | "single-parent" | "unknown";

export const audienceLabels: Record<AudienceType, string> = {
  youth: "청년",
  newlywed: "신혼·신생아",
  multichild: "다자녀",
  senior: "고령자",
  "single-parent": "한부모",
  unknown: "대상 미상",
};

export function extractAudienceType(title: string): AudienceType {
  const compact = title.replaceAll(" ", "");
  // 한부모를 먼저 본다 — "한부모·조손가구 신혼부부" 같은 복합 제목에서
  // 더 좁은 계층이 우선이다.
  if (compact.includes("한부모")) return "single-parent";
  if (compact.includes("신혼") || compact.includes("신생아")) return "newlywed";
  if (compact.includes("다자녀")) return "multichild";
  if (compact.includes("청년")) return "youth";
  if (compact.includes("고령자")) return "senior";
  return "unknown";
}

const result = (status: AudienceStatus, label: string, detail: string): AudienceResult => ({ status, label, detail });

export function evaluateAudience(profile: HousingProfile, notice: { title: string }): AudienceResult {
  if (profile.hasHouse) {
    return result("mismatch", "조건 불일치", "주택 보유로 입력되어 무주택 요건을 충족하지 못할 가능성이 큽니다. 원문에서 세대구성원 범위를 확인하세요.");
  }

  switch (extractAudienceType(notice.title)) {
    case "single-parent":
      return profile.isSingleParent
        ? result("likely", "조건 관련", "한부모 가구로 입력되어 공고 대상과 관련 있습니다. 세부 자격은 원문 확인이 필요합니다.")
        : result("mismatch", "조건 불일치", "한부모 대상 공고이지만 한부모 가구로 입력되지 않았습니다.");

    case "newlywed": {
      const related = profile.maritalStatus !== "single" || profile.children > 0 || profile.isPregnant || profile.isSingleParent;
      return related
        ? result("likely", "조건 관련", "혼인·자녀·임신 조건이 신혼·신생아 대상과 관련 있습니다. 혼인기간과 자녀 연령은 원문에서 확인하세요.")
        : result("mismatch", "조건 불일치", "신혼·신생아 대상 공고이지만 미혼·무자녀·비임신으로 입력되었습니다.");
    }

    case "multichild":
      if (profile.children >= 2) return result("likely", "조건 관련", `자녀 ${profile.children}명으로 입력되어 다자녀 대상과 관련 있습니다. 인정 자녀 범위는 원문에서 확인하세요.`);
      if (profile.children === 1 || profile.isPregnant) return result("review", "추가 확인", "자녀 1명 또는 태아가 입력되었습니다. 태아 포함 여부와 공고별 다자녀 기준을 확인하세요.");
      return result("mismatch", "조건 불일치", "다자녀 대상 공고이지만 자녀가 없는 것으로 입력되었습니다.");

    case "youth":
      if (profile.age < 19 || profile.age > 39) {
        return result("mismatch", "조건 불일치", `만 ${profile.age}세로 입력되어 일반적인 청년 연령 범위(19~39세) 밖입니다. 예외 기준은 원문에서 확인하세요.`);
      }
      if (profile.maritalStatus !== "single") {
        return result("review", "추가 확인", `만 ${profile.age}세이지만 혼인 상태가 입력되어 있습니다. 청년 계층의 미혼 요건과 별도 신혼 계층을 비교하세요.`);
      }
      return result("likely", "조건 관련", `만 ${profile.age}세·미혼으로 입력되어 일반적인 청년 대상과 관련 있습니다. 1순위 복지자격 등 세부 기준은 원문에서 확인하세요.`);

    case "senior":
      return profile.age >= 65
        ? result("likely", "조건 관련", `만 ${profile.age}세로 입력되어 고령자 대상과 관련 있습니다.`)
        : result("mismatch", "조건 불일치", `고령자 대상 공고이지만 만 ${profile.age}세로 입력되었습니다.`);

    default:
      return result("review", "추가 확인", "공고 제목만으로 대상 계층을 판정할 수 없어 원문의 신청 자격 확인이 필요합니다.");
  }
}
