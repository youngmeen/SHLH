import assert from "node:assert/strict";
import test from "node:test";
import { defaultProfile, parseProfile } from "../app/lib/profile.ts";

test("저장된 값이 없으면 기본 프로필을 돌려준다", () => {
  assert.deepEqual(parseProfile(null), defaultProfile);
  assert.deepEqual(parseProfile(undefined), defaultProfile);
  assert.deepEqual(parseProfile({}), defaultProfile);
  assert.deepEqual(parseProfile("깨진 값"), defaultProfile);
});

test("저장된 값을 그대로 읽는다", () => {
  const profile = parseProfile({
    districts: ["강남구", "마포구"],
    age: 42,
    householdSize: 3,
    monthlyIncome: 500,
    totalAssets: 30000,
    hasHouse: true,
    maritalStatus: "married",
    marriageDate: "2020-05-01",
    children: 2,
    youngestChildBirthDate: "2023-03-02",
    isPregnant: true,
    isSingleParent: true,
  });

  assert.deepEqual(profile, {
    districts: ["강남구", "마포구"],
    age: 42,
    householdSize: 3,
    monthlyIncome: 500,
    totalAssets: 30000,
    hasHouse: true,
    maritalStatus: "married",
    marriageDate: "2020-05-01",
    children: 2,
    youngestChildBirthDate: "2023-03-02",
    isPregnant: true,
    isSingleParent: true,
  });
});

test("숫자 필드의 음수와 숫자가 아닌 값은 0 이상 정수로 정리한다", () => {
  const profile = parseProfile({
    age: -5,
    householdSize: "3",
    monthlyIncome: "숫자아님",
    totalAssets: 22000.7,
    children: -1,
  });

  assert.equal(profile.age, 0);
  assert.equal(profile.householdSize, 3);
  assert.equal(profile.monthlyIncome, 310);
  assert.equal(profile.totalAssets, 22000);
  assert.equal(profile.children, 0);
});

test("알 수 없는 혼인상태는 기본값으로 되돌린다", () => {
  assert.equal(parseProfile({ maritalStatus: "이상한값" }).maritalStatus, "single");
  assert.equal(parseProfile({ maritalStatus: 7 }).maritalStatus, "single");
  assert.equal(parseProfile({ maritalStatus: "prospective" }).maritalStatus, "prospective");
});

test("서울 자치구가 아닌 값은 버린다", () => {
  const profile = parseProfile({ districts: ["강남구", "해운대구", "없는구", "마포구"] });
  assert.deepEqual(profile.districts, ["강남구", "마포구"]);
});
