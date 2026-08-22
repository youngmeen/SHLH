import assert from "node:assert/strict";
import test from "node:test";

import { sqmToPyeong, formatArea, formatManwon, summarizeInventory } from "../app/lib/format.ts";

// ─── 평 환산: 계산값이므로 화면에서는 "약"을 붙인다(R44 · calculated) ─────────

test("전용면적을 평으로 환산한다 (1평 = 3.3058㎡)", () => {
  assert.equal(sqmToPyeong(16.99), 5.1);
  assert.equal(sqmToPyeong(44.68), 13.5);
  assert.equal(sqmToPyeong(7.2), 2.2);
});

test("면적 표기는 ㎡와 평을 함께 쓴다", () => {
  assert.equal(formatArea("16.99"), "16.99㎡ · 약 5.1평");
  assert.equal(formatArea(null), null);
  assert.equal(formatArea("면적아님"), null);
});

// ─── 원 → 만원 표기 ──────────────────────────────────────────────────────────

test("원 단위 금액을 만원으로 표기한다", () => {
  assert.equal(formatManwon(36720000), "3,672만원");
  assert.equal(formatManwon(156060), "15.6만원");
  assert.equal(formatManwon(8394200), "839.4만원");
  assert.equal(formatManwon(0), null); // 0은 미기재일 수 있으므로 단정하지 않는다(R43)
  assert.equal(formatManwon(null), null);
});

// ─── 자치구 재고 표본 → 단지별 요약 ───────────────────────────────────────────

const 재고행 = (complexName, address, exclusiveArea, deposit, monthlyRent, supplyType = "매입임대") =>
  ({ complexName, address, pnu: null, unitNo: null, exclusiveArea, deposit, monthlyRent, supplyType });

test("재고 표본을 단지별로 묶어 위치·면적 범위·호수를 요약한다", () => {
  const summary = summarizeInventory([
    재고행("휴먼에코빌4차", "서울특별시 금천구 독산로96길 27-6", "7.20", 8394200, 109400),
    재고행("휴먼에코빌4차", "서울특별시 금천구 독산로96길 27-6", "12.50", 8590100, 111900),
    재고행("가산타운", "서울특별시 금천구 가산로 1", "24.00", 0, 0),
  ]);

  assert.equal(summary.length, 2);
  const first = summary[0]; // 호수가 많은 단지가 앞에 온다
  assert.equal(first.name, "휴먼에코빌4차");
  assert.equal(first.address, "서울특별시 금천구 독산로96길 27-6");
  assert.equal(first.count, 2);
  assert.deepEqual({ min: first.minArea, max: first.maxArea }, { min: 7.2, max: 12.5 });
  assert.equal(first.minDeposit, 8394200); // 0원은 범위 계산에서 뺀다 — 미기재를 최저가로 만들지 않는다
});

test("단지명이 없으면 주소로 묶고, 이름 없는 행도 버리지 않는다", () => {
  const summary = summarizeInventory([
    재고행(null, "서울특별시 금천구 남부순환로112길 25", "8.84", 0, 0),
    재고행(null, "서울특별시 금천구 남부순환로112길 25", "9.12", 0, 0),
  ]);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].count, 2);
  assert.equal(summary[0].minDeposit, null); // 전부 0이면 범위 없음 — 0원이라고 말하지 않는다
});
