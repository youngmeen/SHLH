import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAudience } from "../app/lib/audience-match.ts";

const baseProfile = {
  age: 31,
  hasHouse: false,
  maritalStatus: "single",
  children: 0,
  isPregnant: false,
  isSingleParent: false,
};

function notice(title) {
  return { title };
}

test("미혼·무자녀 프로필에서 명백히 다른 대상 공고를 추천하지 않는다", () => {
  assert.equal(evaluateAudience(baseProfile, notice("신혼·신생아 매입임대 모집")).status, "mismatch");
  assert.equal(evaluateAudience(baseProfile, notice("다자녀 전세임대 모집")).status, "mismatch");
  assert.equal(evaluateAudience(baseProfile, notice("청년 매입임대 모집")).status, "likely");
});

test("가구 입력에 따라 신혼·다자녀 공고의 관련도를 나눈다", () => {
  assert.equal(evaluateAudience({ ...baseProfile, maritalStatus: "married" }, notice("신혼부부 임대")).status, "likely");
  assert.equal(evaluateAudience({ ...baseProfile, children: 1 }, notice("다자녀 임대")).status, "review");
  assert.equal(evaluateAudience({ ...baseProfile, children: 2 }, notice("다자녀 임대")).status, "likely");
});

test("제목으로 판정할 수 없는 공고는 추가 확인으로 남긴다", () => {
  assert.equal(evaluateAudience(baseProfile, notice("공공임대 예비입주자 모집")).status, "review");
});

test("주택 보유 입력은 무주택 요건 확인 대상으로 추천에서 제외한다", () => {
  const result = evaluateAudience({ ...baseProfile, hasHouse: true }, notice("청년 매입임대 모집"));
  assert.equal(result.status, "mismatch");
  assert.match(result.detail, /주택 보유/);
});

test("기혼으로 입력한 청년 공고는 혼인 조건을 추가 확인한다", () => {
  assert.equal(evaluateAudience({ ...baseProfile, maritalStatus: "married" }, notice("청년 전세임대 모집")).status, "review");
});
