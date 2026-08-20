import { SEOUL_DISTRICTS, SUPPLY_TYPE_KEYWORDS, shortDistrictName } from "./notice-types.ts";

/**
 * 공고의 단지명과 재고(단지정보 API)의 건물명을 잇는다.
 *
 * 실측(SPEC 5절·6절)이 이 모듈의 전제다.
 *  · 잇히는 예 — 공고 `서울번동3 행복주택`, 재고 `서울번동3 고령자복지주택(행복주택)`.
 *    공고문 PDF의 전용면적 21.99·44.68과 재고 값이 일치했다.
 *  · 잇히지 않는 예 — 공고는 사업 브랜드명(`소셜믹스형 청년주택`·`특화형`), 재고는
 *    물리적 건물명을 쓴다. 금천구 4,825행에 `소셜믹스형 청년주택`은 0건이었다.
 *
 * 잇지 못하면 `미확보`로 남긴다. 비슷한 이름에 붙이는 것은 공급주택을 만드는 일이고
 * R44 위반이다. 그래서 이 함수는 **한 방향으로만** 본다 — 재고의 건물명이 공고의
 * 단지명을 품고 있을 때만 잇는다. 반대 방향을 허용하면 `소셜믹스형 청년주택`이
 * `청년주택`이라는 이름의 아무 단지에 붙는다.
 */

export type LinkReason = "name-too-weak" | "no-name-match" | "type-mismatch";

/**
 * 이름과 유형만 본다. 수집이 만든 StoredHousingUnit과 DB에서 읽은 행이 칼럼 타입이
 * 조금 다른데(numeric은 문자열로 온다) 이 판단에는 관계없다.
 */
export type LinkableUnit = { complexName: string | null; supplyType: string | null };

export type InventoryLink<T extends LinkableUnit = LinkableUnit> =
  | { status: "matched"; units: T[]; matchedBy: "complex-name"; typeMatched: boolean; reason: null }
  | { status: "unmatched"; units: []; matchedBy: null; typeMatched: false; reason: LinkReason };

function normalize(value: string) {
  // 공백·가운뎃점·괄호만 지운다. 숫자와 영문은 단지를 가르는 정보다(`A24BL`·`번동3`).
  return value.replace(/[\s·・()（）[\]]/g, "").toLowerCase();
}

/** 단지명이 아니라 행정구역 이름인 값. 재고에 실제로 섞여 있다(`서울특별시 금천구`·`-`). */
const ADMIN_NAMES = new Set(
  [
    "서울",
    "서울시",
    "서울특별시",
    ...SEOUL_DISTRICTS,
    ...SEOUL_DISTRICTS.map(shortDistrictName),
    ...SEOUL_DISTRICTS.map((district) => `서울특별시${district}`),
  ].map(normalize),
);

// 두 글자 이름(`가동`)으로 부분 문자열 매칭을 하면 자치구 재고가 통째로 붙는다.
const MIN_NAME_LENGTH = 3;

function isWeakName(normalized: string) {
  return normalized.length < MIN_NAME_LENGTH || ADMIN_NAMES.has(normalized);
}

/**
 * 단지명에서 공급유형 낱말을 떼어낸다.
 *
 * `서울번동3 행복주택` → `서울번동3` + `행복주택`. 재고는 같은 단지를 `서울번동3
 * 고령자복지주택(행복주택)`으로 부르므로 유형을 떼지 않으면 영원히 못 만난다.
 * 공식 유형 표기(SUPPLY_TYPE_KEYWORDS)만 떼어낸다. 사업 브랜드명을 유형으로 보면
 * 남는 낱말이 너무 짧아져 엉뚱한 단지에 붙는다.
 */
export function splitComplexName(name: string): { base: string; type: string | null } {
  const trimmed = (name ?? "").trim();
  const type = SUPPLY_TYPE_KEYWORDS.find((keyword) => trimmed.includes(keyword)) ?? null;
  if (!type) return { base: trimmed, type: null };

  const base = trimmed.replace(type, " ").replace(/[\s()（）]+/g, " ").trim();
  // 유형을 떼면 아무것도 안 남는 이름(`행복주택`)은 떼지 않은 것으로 본다.
  return base === "" ? { base: trimmed, type } : { base, type };
}

function mentionsType(unit: LinkableUnit, type: string) {
  return (unit.supplyType ?? "").includes(type) || (unit.complexName ?? "").includes(type);
}

const UNMATCHED = (reason: LinkReason): InventoryLink<never> => ({
  status: "unmatched",
  units: [],
  matchedBy: null,
  typeMatched: false,
  reason,
});

/**
 * 재고에서 이 단지명에 해당하는 행을 찾는다.
 *
 * @param complexName 공고가 말하는 단지명 (유형이 붙어 있어도 된다)
 * @param inventory   그 자치구의 재고 행
 */
export function linkInventoryUnits<T extends LinkableUnit>(
  complexName: string,
  inventory: T[],
  options: { type?: string | null } = {},
): InventoryLink<T> {
  const parsed = splitComplexName(complexName ?? "");
  // 출처가 공급유형을 따로 주면(마이홈 모집공고의 suplyTyNm) 이름에서 추측하지 않는다.
  const base = parsed.base;
  const type = options.type?.trim() || parsed.type;
  const needle = normalize(base);
  if (isWeakName(needle)) return UNMATCHED("name-too-weak");

  const byName = inventory.filter((unit) => {
    const name = normalize(unit.complexName ?? "");
    // 재고 이름도 약하면(`-`·`가동`·자치구명) 이름으로 잇지 않는다.
    return !isWeakName(name) && name.includes(needle);
  });
  if (byName.length === 0) return UNMATCHED("no-name-match");

  if (!type) {
    // 유형을 모르면 그 단지의 모든 행이 후보다. 확인한 것과 구분해서 표시한다.
    return { status: "matched", units: byName, matchedBy: "complex-name", typeMatched: false, reason: null };
  }

  const byType = byName.filter((unit) => mentionsType(unit, type));
  // 이름은 맞았지만 유형이 전부 다르면 같은 단지의 다른 공급 물량이다. 잇지 않는다.
  if (byType.length === 0) return UNMATCHED("type-mismatch");

  return { status: "matched", units: byType, matchedBy: "complex-name", typeMatched: true, reason: null };
}
