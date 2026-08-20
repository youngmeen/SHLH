import assert from "node:assert/strict";
import test from "node:test";
import { linkInventoryUnits, splitComplexName } from "../app/lib/unit-link.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 공고의 단지명과 재고(단지정보 API)의 건물명을 잇는다.
//
// 실측(SPEC 5절·6절)에서 확인한 두 가지가 이 모듈의 존재 이유다.
//  · 잇히는 경우 — 공고 `서울번동3 행복주택`, 재고 `서울번동3 고령자복지주택(행복주택)`.
//    같은 단지에 영구임대와 행복주택이 섞여 있어 유형까지 봐야 한다.
//  · 잇히지 않는 경우 — 공고는 사업 브랜드명(`소셜믹스형 청년주택`), 재고는 물리적
//    건물명을 쓴다. 이때는 `미확보`로 남긴다. 억지로 잇는 것이 R44 위반이다.
// ─────────────────────────────────────────────────────────────────────────────

/** 단지정보 API가 준 행의 모양을 따른다(rental-inventory가 만드는 형태). */
function 재고행(complexName, supplyType, extra = {}) {
  return {
    source: "myhome-complex",
    sourceKey: `${complexName}:${supplyType}:${extra.unitNo ?? "-"}`,
    noticeSourceId: null,
    instName: "SH공사",
    sido: "서울특별시",
    sigungu: extra.sigungu ?? "강북구",
    complexName,
    address: extra.address ?? "서울특별시 강북구 삼양로 581-11",
    pnu: "1130510400100650014",
    unitNo: extra.unitNo ?? "201",
    supplyType,
    houseType: "다세대주택",
    exclusiveArea: extra.exclusiveArea ?? 44.68,
    commonArea: null,
    householdCount: 56,
    totalHousehold: null,
    deposit: 51660000,
    monthlyRent: 532300,
    heating: "개별난방",
    parkingCount: 10,
    builtOn: "2021-03-01",
    valueSource: "official",
  };
}

const 번동3_재고 = [
  재고행("서울번동3 고령자복지주택(행복주택)", "행복주택", { exclusiveArea: 44.68 }),
  재고행("서울번동3 고령자복지주택(행복주택)", "행복주택", { exclusiveArea: 21.99, unitNo: "202" }),
  재고행("서울번동3 고령자복지주택", "영구임대", { exclusiveArea: 16.99, unitNo: "301" }),
  재고행("독산로22길93-7", "매입임대", { sigungu: "금천구" }),
  재고행("-", "매입임대", { sigungu: "금천구" }),
  재고행("서울특별시 금천구", "매입임대", { sigungu: "금천구" }),
];

test("공고 단지명이 재고 건물명에 들어 있으면 잇는다", () => {
  const result = linkInventoryUnits("서울번동3 행복주택", 번동3_재고);

  assert.equal(result.status, "matched");
  assert.equal(result.units.length, 2, "행복주택 두 행만 이어야 한다");
  assert.deepEqual(result.units.map((unit) => unit.exclusiveArea), [44.68, 21.99]);
  assert.equal(result.matchedBy, "complex-name");
});

test("같은 단지라도 공급유형이 다른 행은 잇지 않는다", () => {
  // 실측: 같은 단지에 영구임대와 행복주택이 섞여 있다. 유형을 무시하면 남의 주택을 붙인다.
  const result = linkInventoryUnits("서울번동3 행복주택", 번동3_재고);

  assert.ok(
    result.units.every((unit) => unit.supplyType === "행복주택"),
    "영구임대 행이 섞이면 안 된다",
  );
});

test("재고에 없는 사업 브랜드명은 미확보로 남긴다", () => {
  // 금천구 공고의 `소셜믹스형 청년주택`은 재고 4,825행에 0건이었다(실측).
  const result = linkInventoryUnits("소셜믹스형 청년주택", 번동3_재고);

  assert.equal(result.status, "unmatched");
  assert.equal(result.reason, "no-name-match");
  assert.deepEqual(result.units, []);
});

test("이름이 맞아도 유형이 전부 어긋나면 잇지 않는다", () => {
  const result = linkInventoryUnits("서울번동3 국민임대", 번동3_재고);

  assert.equal(result.status, "unmatched");
  assert.equal(result.reason, "type-mismatch", "이름만 맞은 것을 잇힘으로 표시하면 안 된다");
  assert.deepEqual(result.units, []);
});

test("유형을 모르면 이름만으로 잇고 그렇다고 표시한다", () => {
  const result = linkInventoryUnits("서울번동3 고령자복지주택", 번동3_재고);

  assert.equal(result.status, "matched");
  assert.equal(result.units.length, 3, "유형을 모르면 그 단지의 모든 행이 후보다");
  assert.equal(result.typeMatched, false, "유형까지 확인한 것과 구분해야 한다");
});

test("이름이 너무 짧거나 주소·자치구명이면 잇지 않는다", () => {
  // 재고 단지명에는 `-`·`서울특별시 금천구`·`가동`이 섞여 있다(실측). 이런 이름으로
  // 부분 문자열 매칭을 하면 자치구 전체가 한 공고에 붙는다.
  assert.equal(linkInventoryUnits("-", 번동3_재고).status, "unmatched");
  assert.equal(linkInventoryUnits("가동", 번동3_재고).status, "unmatched");
  assert.equal(linkInventoryUnits("서울특별시", 번동3_재고).reason, "name-too-weak");
  assert.equal(linkInventoryUnits("", 번동3_재고).reason, "name-too-weak");
});

test("이름이 정확히 같은 행은 모두 잇는다", () => {
  const 금천_재고 = [
    재고행("G밸리하우스", "매입임대", { sigungu: "금천구", unitNo: "201" }),
    재고행("G밸리하우스", "매입임대", { sigungu: "금천구", unitNo: "202" }),
    재고행("소셜믹스타워", "매입임대", { sigungu: "금천구" }),
  ];

  const result = linkInventoryUnits("G밸리하우스", 금천_재고);
  assert.equal(result.units.length, 2);
  assert.deepEqual(result.units.map((unit) => unit.unitNo), ["201", "202"]);
});

test("단지명에서 공급유형 낱말을 떼어낸다", () => {
  assert.deepEqual(splitComplexName("서울번동3 행복주택"), { base: "서울번동3", type: "행복주택" });
  assert.deepEqual(splitComplexName("G밸리하우스"), { base: "G밸리하우스", type: null });
  // `청년주택`은 공식 공급유형 표기가 아니다. 떼어내면 `소셜믹스형`만 남아 엉뚱한
  // 단지에 붙을 수 있다.
  assert.deepEqual(splitComplexName("소셜믹스형 청년주택"), { base: "소셜믹스형 청년주택", type: null });
});
