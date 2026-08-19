import { SEOUL_DISTRICTS, type District } from "./notice-types.ts";
import type { HousingProfile, MaritalStatus } from "./audience-match.ts";

// 화면과 cron이 같은 프로필을 봐야 한다. 화면(page.tsx)에만 두면 브라우저가
// 닫힌 동안 알림 판정을 할 수 없으므로 서버에서도 읽을 수 있는 곳에 둔다.
export type Profile = HousingProfile & {
  districts: District[];
  householdSize: number;
  monthlyIncome: number;
  totalAssets: number;
  marriageDate: string;
  youngestChildBirthDate: string;
};

const MARITAL_STATUSES: MaritalStatus[] = ["single", "married", "prospective"];

export const defaultProfile: Profile = {
  districts: SEOUL_DISTRICTS,
  age: 31,
  householdSize: 1,
  monthlyIncome: 310,
  totalAssets: 22000,
  hasHouse: false,
  maritalStatus: "single",
  marriageDate: "",
  children: 0,
  youngestChildBirthDate: "",
  isPregnant: false,
  isSingleParent: false,
};

/**
 * 저장소나 HTTP 본문에서 온 값을 프로필로 정리한다. 값이 없거나 형태가
 * 어긋나면 기본값으로 메운다. cron이 이 결과로 판정하므로 절대 던지지 않는다.
 */
export function parseProfile(input: unknown): Profile {
  if (!input || typeof input !== "object") return { ...defaultProfile };
  const raw = input as Partial<Profile>;

  // 입력이 음수·문자열·NaN이어도 판정이 멈추지 않아야 한다. 읽을 수 없으면 기본값.
  const count = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
  };

  return {
    districts: Array.isArray(raw.districts)
      ? raw.districts.filter((district): district is District => SEOUL_DISTRICTS.includes(district))
      : defaultProfile.districts,
    age: count(raw.age, defaultProfile.age),
    householdSize: count(raw.householdSize, defaultProfile.householdSize),
    monthlyIncome: count(raw.monthlyIncome, defaultProfile.monthlyIncome),
    totalAssets: count(raw.totalAssets, defaultProfile.totalAssets),
    hasHouse: raw.hasHouse ?? defaultProfile.hasHouse,
    maritalStatus: MARITAL_STATUSES.includes(raw.maritalStatus as MaritalStatus)
      ? (raw.maritalStatus as MaritalStatus)
      : defaultProfile.maritalStatus,
    marriageDate: raw.marriageDate ?? defaultProfile.marriageDate,
    children: count(raw.children, defaultProfile.children),
    youngestChildBirthDate: raw.youngestChildBirthDate ?? defaultProfile.youngestChildBirthDate,
    isPregnant: raw.isPregnant ?? defaultProfile.isPregnant,
    isSingleParent: raw.isSingleParent ?? defaultProfile.isSingleParent,
  };
}
