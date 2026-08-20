import assert from "node:assert/strict";
import test from "node:test";
import { parseInventory } from "../app/lib/rental-inventory.ts";
import { SEOUL_DISTRICTS, SEOUL_SIGUNGU_CODE } from "../app/lib/notice-types.ts";

/** 실제 응답 한 행. 필드 이름과 값 모양을 바꾸지 말 것 (SPEC 5절 실측값). */
const 강북구_HJ포레스트_201 = {
  hsmpSn: 31860684,
  insttNm: "SH공사",
  brtcCode: "11",
  brtcNm: "서울특별시",
  signguCode: "305",
  signguNm: "강북구",
  hsmpNm: "HJ포레스트",
  rnAdres: "서울특별시 강북구 삼양로 581-11",
  pnu: "1130510400100650014",
  competDe: "",
  hshldCo: 3,
  suplyTyNm: "매입임대",
  styleNm: "201",
  suplyPrvuseAr: 56.05,
  suplyCmnuseAr: 8.89,
  houseTyNm: "다세대주택",
  heatMthdDetailNm: "",
  buldStleNm: "",
  elvtrInstlAtNm: "",
  parkngCo: 0,
  bassRentGtn: 51660000,
  bassMtRntchrg: 532300,
  bassCnvrsGtnLmt: 0,
};

function payload(items) {
  return { response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE" }, body: { item: items, totalCount: String(items.length) } } };
}

test("호 단위 행을 주택으로 옮긴다", () => {
  const { units, total } = parseInventory(payload([강북구_HJ포레스트_201, { ...강북구_HJ포레스트_201, styleNm: "202", suplyPrvuseAr: 53.7, bassRentGtn: 50040000, bassMtRntchrg: 515600 }]));

  assert.equal(total, 2);
  assert.equal(units.length, 2, "호마다 한 행이어야 한다");
  assert.deepEqual(units.map((u) => u.unitNo), ["201", "202"]);
  assert.notEqual(units[0].sourceKey, units[1].sourceKey, "호가 다르면 키가 달라야 한다");

  const [first] = units;
  assert.equal(first.source, "myhome-complex");
  assert.equal(first.instName, "SH공사", "SH 재고가 이 API로 들어온다");
  assert.equal(first.complexName, "HJ포레스트");
  assert.equal(first.address, "서울특별시 강북구 삼양로 581-11");
  assert.equal(first.pnu, "1130510400100650014");
  assert.equal(first.exclusiveArea, 56.05, "전용면적 — 모집공고 API에는 없던 값");
  assert.equal(first.commonArea, 8.89);
  assert.equal(first.deposit, 51660000);
  assert.equal(first.monthlyRent, 532300);
  assert.equal(first.householdCount, 3);
  assert.equal(first.valueSource, "official");
  // 재고는 특정 공고에 속하지 않는다. 이름이 어긋나므로 억지로 잇지 않는다(R44).
  assert.equal(first.noticeSourceId, null);
});

test("빈 값은 만들지 않고 null로 둔다", () => {
  const { units } = parseInventory(payload([강북구_HJ포레스트_201]));
  assert.equal(units[0].builtOn, null, "준공일이 빈 문자열이면 null");
  assert.equal(units[0].heating, null);
  assert.equal(units[0].totalHousehold, null, "이 API는 단지 총세대를 주지 않는다");
  assert.equal(units[0].parkingCount, 0, "0은 빈 값과 구분한다");
});

test("응답 항목이 하나면 배열이 아니어도 읽는다", () => {
  const { units } = parseInventory(payload(강북구_HJ포레스트_201));
  assert.equal(units.length, 1);
});

test("API 오류는 던진다", () => {
  assert.throws(
    () => parseInventory({ response: { header: { resultCode: "11", resultMsg: "NO_MANDATORY_REQUEST_PARAMETER_ERROR" } } }),
    /NO_MANDATORY_REQUEST_PARAMETER_ERROR/,
  );
});

test("자치구 25개의 시군구 코드가 모두 있다", () => {
  for (const district of SEOUL_DISTRICTS) {
    assert.match(SEOUL_SIGUNGU_CODE[district] ?? "", /^\d{3}$/, `${district} 코드가 3자리가 아니다`);
  }
  const codes = Object.values(SEOUL_SIGUNGU_CODE);
  assert.equal(new Set(codes).size, codes.length, "코드가 겹친다");
});

test("완전히 같은 행이 와도 버리지 않고 키로 구분한다", () => {
  // 실측: 자치구마다 1~4건씩 모든 필드가 같거나 공용면적만 다른 행이 온다.
  // 어느 쪽이 실제 세대인지 알 수 없으므로 임의로 합치지 않는다(R44).
  const { units } = parseInventory(payload([강북구_HJ포레스트_201, 강북구_HJ포레스트_201, { ...강북구_HJ포레스트_201, suplyCmnuseAr: 9.12 }]));

  assert.equal(units.length, 3, "행을 버리지 않는다");
  assert.equal(new Set(units.map((u) => u.sourceKey)).size, 3, "키가 모두 달라야 한다");
  assert.match(units[1].sourceKey, /#2$/, "같은 내용의 두 번째 행에는 순번이 붙는다");
  assert.doesNotMatch(units[2].sourceKey, /#/, "공용면적이 다르면 순번 없이 구분된다");
});

test("임대조건이 다르면 다른 주택으로 본다", () => {
  // 같은 단지·같은 주택형인데 보증금·월임대료가 다른 행이 실제로 온다.
  const { units } = parseInventory(
    payload([
      { ...강북구_HJ포레스트_201, bassRentGtn: 4054000, bassMtRntchrg: 167360 },
      { ...강북구_HJ포레스트_201, bassRentGtn: 2791000, bassMtRntchrg: 81440 },
    ]),
  );
  assert.equal(new Set(units.map((u) => u.sourceKey)).size, 2);
});
