import assert from "node:assert/strict";
import test from "node:test";

import { ageOnDate, parseAmountToManwon, parseEligibilityText, evaluateEligibility } from "../app/lib/eligibility.ts";
import { defaultProfile, parseProfile } from "../app/lib/profile.ts";

// ─── 만 나이 계산: 판정 기준일은 공고일이다(R12) ───────────────────────────────

test("만 나이는 기준일에 생일이 지났는지로 계산한다", () => {
  assert.equal(ageOnDate("1995-06-15", "2026-06-14"), 30); // 생일 전날
  assert.equal(ageOnDate("1995-06-15", "2026-06-15"), 31); // 생일 당일
  assert.equal(ageOnDate("1995-06-15", "2026-06-16"), 31); // 생일 다음날
});

test("윤년 2월 29일생은 평년에는 3월 1일에 한 살을 더한다", () => {
  assert.equal(ageOnDate("2000-02-29", "2026-02-28"), 25);
  assert.equal(ageOnDate("2000-02-29", "2026-03-01"), 26);
});

test("읽을 수 없는 생년월일은 null이다", () => {
  assert.equal(ageOnDate("", "2026-06-15"), null);
  assert.equal(ageOnDate("생년월일아님", "2026-06-15"), null);
  assert.equal(ageOnDate("2026-13-40", "2026-06-15"), null);
});

// ─── 금액 파싱: 원문 문구를 만원 단위 숫자로 ───────────────────────────────────

test("억·만원 조합 문구를 만원으로 환산한다", () => {
  assert.equal(parseAmountToManwon("3억 6,100만원"), 36100);
  assert.equal(parseAmountToManwon("36,100만원"), 36100);
  assert.equal(parseAmountToManwon("2억원"), 20000);
  assert.equal(parseAmountToManwon("3,708만원"), 3708);
  assert.equal(parseAmountToManwon("금액 없음"), null);
});

// ─── 신청자격 텍스트 파싱 ─────────────────────────────────────────────────────

test("연령 범위 문구를 읽는다", () => {
  const parsed = parseEligibilityText("신청자격 공고일 현재 만 19세 이상 39세 이하인 미혼 청년");
  assert.deepEqual({ min: parsed.ageRange.min, max: parsed.ageRange.max }, { min: 19, max: 39 });
});

test("소득 퍼센트·자산·자동차·청약통장 요구를 읽는다", () => {
  const text = "신청자격 도시근로자 가구원수별 가구당 월평균소득의 100% 이하이고 총자산가액 36,100만원 이하, 자동차가액 3,708만원 이하. 주택청약종합저축 가입자.";
  const parsed = parseEligibilityText(text);
  assert.equal(parsed.incomePercent.percent, 100);
  assert.equal(parsed.assetLimitManwon.amount, 36100);
  assert.equal(parsed.carLimitManwon.amount, 3708);
  assert.ok(parsed.requiresSubscription);
});

test("텍스트가 없으면 아무것도 확정하지 않는다", () => {
  const parsed = parseEligibilityText(null);
  assert.equal(parsed.ageRange, null);
  assert.equal(parsed.incomePercent, null);
  assert.equal(parsed.assetLimitManwon, null);
  assert.equal(parsed.carLimitManwon, null);
  assert.equal(parsed.requiresSubscription, null);
});

// ─── 판정: R12~R14 ───────────────────────────────────────────────────────────

const 청년공고 = { title: "청년 매입임대주택 입주자 모집", publishedAt: "2026-08-01" };

const 프로필 = (extra) => ({ ...defaultProfile, birthDate: "1995-06-15", ...extra });

test("원문 연령 범위가 있으면 그 값으로 판정하고 원문을 근거로 남긴다", () => {
  const result = evaluateEligibility(프로필(), 청년공고, "신청자격 공고일 현재 만 19세 이상 39세 이하");
  const age = result.items.find((item) => item.key === "age");
  assert.equal(age.status, "met");
  assert.ok(age.basis.includes("19세 이상 39세 이하")); // 원문 인용
  assert.ok(age.basis.includes("만 31")); // 공고일(2026-08-01) 기준 만 31세
});

test("원문 연령 범위 밖이면 미충족이되, 원문 확인 안내를 함께 남긴다", () => {
  const result = evaluateEligibility(프로필({ birthDate: "1980-01-01" }), 청년공고, "만 19세 이상 39세 이하");
  const age = result.items.find((item) => item.key === "age");
  assert.equal(age.status, "unmet");
  assert.ok(age.basis.includes("원문"));
  assert.equal(result.verdict, "ineligible");
});

test("생년월일이 없으면 저장된 나이로 판정하고 그 사실을 밝힌다", () => {
  const result = evaluateEligibility({ ...defaultProfile, birthDate: "" }, 청년공고, null);
  const age = result.items.find((item) => item.key === "age");
  assert.ok(age.basis.includes("생년월일 미입력"));
});

test("R14: 상세 텍스트가 없으면 소득·자산·청약통장은 확인 필요이고, 그것만으로 지원 불가가 되지 않는다", () => {
  const result = evaluateEligibility(프로필(), 청년공고, null);
  for (const key of ["income", "assets", "subscription"]) {
    assert.equal(result.items.find((item) => item.key === key).status, "review", key);
  }
  assert.notEqual(result.verdict, "ineligible");
});

test("핵심 조건(연령·무주택·혼인)이 충족이고 미충족이 없으면 지원 가능이다", () => {
  // ROADMAP 완료 조건 예시: 소득·자산이 확인 필요여도 전체는 지원 가능일 수 있다.
  const result = evaluateEligibility(프로필(), 청년공고, "만 19세 이상 39세 이하");
  assert.equal(result.verdict, "eligible");
});

test("주택 보유는 무주택 항목 미충족이고 전체 판정은 비추천이다", () => {
  const result = evaluateEligibility(프로필({ hasHouse: true }), 청년공고, null);
  assert.equal(result.items.find((item) => item.key === "homeless").status, "unmet");
  assert.equal(result.verdict, "ineligible");
});

test("원문 자산 한도가 있으면 입력값과 비교한다", () => {
  const text = "총자산가액 36,100만원 이하";
  const under = evaluateEligibility(프로필({ totalAssets: 22000 }), 청년공고, text);
  const over = evaluateEligibility(프로필({ totalAssets: 40000 }), 청년공고, text);
  assert.equal(under.items.find((item) => item.key === "assets").status, "met");
  assert.equal(over.items.find((item) => item.key === "assets").status, "unmet");
});

test("청약통장 미보유는 접수 전 가입이 가능하므로 미충족이 아니라 확인 필요다", () => {
  const result = evaluateEligibility(
    프로필({ hasSubscriptionAccount: false }),
    청년공고,
    "주택청약종합저축 가입자에 한함",
  );
  const item = result.items.find((entry) => entry.key === "subscription");
  assert.equal(item.status, "review");
  assert.ok(item.basis.includes("가입"));
});

test("소득 퍼센트 기준은 기준표가 없으므로 원문을 인용하고 확인 필요로 남긴다", () => {
  const result = evaluateEligibility(프로필(), 청년공고, "도시근로자 월평균소득의 100% 이하");
  const item = result.items.find((entry) => entry.key === "income");
  assert.equal(item.status, "review");
  assert.ok(item.basis.includes("100%"));
});

// ─── 프로필 하위호환(G8): 옛 저장값이 깨지지 않는다 ─────────────────────────────

test("생년월일 없이 나이만 저장된 옛 프로필을 그대로 읽는다", () => {
  const profile = parseProfile({ age: 42, householdSize: 3 });
  assert.equal(profile.age, 42);
  assert.equal(profile.birthDate, "");
  assert.equal(profile.hasSubscriptionAccount, false);
  assert.equal(profile.carValue, 0);
  assert.equal(profile.residence, "seoul");
  assert.equal(profile.welfare, "none");
});

test("형태가 어긋난 생년월일·거주지·복지자격은 기본값으로 되돌린다", () => {
  const profile = parseProfile({ birthDate: "95년 6월", residence: "부산", welfare: "이상한값" });
  assert.equal(profile.birthDate, "");
  assert.equal(profile.residence, "seoul");
  assert.equal(profile.welfare, "none");
});
