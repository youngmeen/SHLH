import { SEOUL_DISTRICTS, type District } from "./notice-types.ts";
import type { HousingProfile, MaritalStatus } from "./audience-match.ts";

// 화면과 cron이 같은 프로필을 봐야 한다. 화면(page.tsx)에만 두면 브라우저가
// 닫힌 동안 알림 판정을 할 수 없으므로 서버에서도 읽을 수 있는 곳에 둔다.

/** 거주지 구분. 자격 판정(Phase 3)의 거주 조건 항목이 쓴다. */
export type Residence = "seoul" | "capital" | "other";

/** 복지자격. 순위 판정(1순위 수급자 등)에 쓰이는 입력이다. */
export type Welfare = "none" | "recipient" | "near-poor";

export type Profile = HousingProfile & {
  districts: District[];
  /**
   * 생년월일(YYYY-MM-DD). 판정 기준일(공고일)에 따라 만 나이가 달라지므로
   * 나이 숫자가 아니라 생년월일을 저장한다(G8·R12). 비어 있으면 아래 age를
   * fallback으로 쓴다 — 이미 저장된 옛 프로필이 깨지면 안 된다.
   */
  birthDate: string;
  householdSize: number;
  monthlyIncome: number;
  totalAssets: number;
  /** 자동차 가액(만원). 0이면 자동차 없음으로 입력된 것이다. */
  carValue: number;
  residence: Residence;
  welfare: Welfare;
  /** 청약통장(주택청약종합저축 등) 보유 여부와 납입 인정 회차. */
  hasSubscriptionAccount: boolean;
  subscriptionPaymentCount: number;
  marriageDate: string;
  youngestChildBirthDate: string;
};

const MARITAL_STATUSES: MaritalStatus[] = ["single", "married", "prospective"];
const RESIDENCES: Residence[] = ["seoul", "capital", "other"];
const WELFARES: Welfare[] = ["none", "recipient", "near-poor"];

export const defaultProfile: Profile = {
  districts: SEOUL_DISTRICTS,
  birthDate: "",
  age: 31,
  householdSize: 1,
  monthlyIncome: 310,
  totalAssets: 22000,
  carValue: 0,
  residence: "seoul",
  welfare: "none",
  hasSubscriptionAccount: false,
  subscriptionPaymentCount: 0,
  hasHouse: false,
  maritalStatus: "single",
  marriageDate: "",
  children: 0,
  youngestChildBirthDate: "",
  isPregnant: false,
  isSingleParent: false,
};

/** YYYY-MM-DD 형태이고 실제로 존재하는 날짜일 때만 인정한다. */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

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
    birthDate: isValidDateString(raw.birthDate) ? raw.birthDate : defaultProfile.birthDate,
    age: count(raw.age, defaultProfile.age),
    householdSize: count(raw.householdSize, defaultProfile.householdSize),
    monthlyIncome: count(raw.monthlyIncome, defaultProfile.monthlyIncome),
    totalAssets: count(raw.totalAssets, defaultProfile.totalAssets),
    carValue: count(raw.carValue, defaultProfile.carValue),
    residence: RESIDENCES.includes(raw.residence as Residence) ? (raw.residence as Residence) : defaultProfile.residence,
    welfare: WELFARES.includes(raw.welfare as Welfare) ? (raw.welfare as Welfare) : defaultProfile.welfare,
    hasSubscriptionAccount: raw.hasSubscriptionAccount ?? defaultProfile.hasSubscriptionAccount,
    subscriptionPaymentCount: count(raw.subscriptionPaymentCount, defaultProfile.subscriptionPaymentCount),
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
