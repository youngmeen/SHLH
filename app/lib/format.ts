// ─────────────────────────────────────────────────────────────────────────────
// 위치·면적·금액 표기 (실사용 피드백 2026-08-23: "위치가 어디이며 몇 평인지
// 안 보이면 활용할 수 없다")
//
// 평 환산은 단위 변환 계산값이다 — 공식 수치가 아니므로 화면에서는 "약"을
// 붙인다(R44의 value_source 구분으로는 calculated). 금액 0은 원본 데이터에서
// 미기재일 수 있으므로 0원이라고 단정해 표기하지 않는다(R43).
// ─────────────────────────────────────────────────────────────────────────────

/** 1평 = 3.3058㎡. 소수 1자리 반올림. */
export function sqmToPyeong(sqm: number): number {
  return Math.round((sqm / 3.3058) * 10) / 10;
}

/** "16.99" → "16.99㎡ · 약 5.1평". 숫자로 못 읽으면 null. */
export function formatArea(exclusiveArea: string | null): string | null {
  if (!exclusiveArea) return null;
  const sqm = Number(exclusiveArea);
  if (!Number.isFinite(sqm) || sqm <= 0) return null;
  return `${exclusiveArea}㎡ · 약 ${sqmToPyeong(sqm)}평`;
}

/** 원 단위 금액 → "3,672만원" / "15.6만원". 0이나 없음은 null — 미기재일 수 있다. */
export function formatManwon(won: number | null): string | null {
  if (won === null || !Number.isFinite(won) || won <= 0) return null;
  const man = won / 10000;
  const rounded = Math.round(man * 10) / 10;
  return `${rounded.toLocaleString()}만원`;
}

export type InventoryUnitRow = {
  complexName: string | null;
  address: string | null;
  pnu: string | null;
  unitNo: string | null;
  exclusiveArea: string | null;
  deposit: number | null;
  monthlyRent: number | null;
  supplyType: string | null;
};

export type ComplexSummary = {
  name: string;
  address: string | null;
  count: number;
  minArea: number | null;
  maxArea: number | null;
  minDeposit: number | null;
  maxDeposit: number | null;
  minRent: number | null;
  maxRent: number | null;
  supplyTypes: string[];
};

/**
 * 자치구 재고 표본(호 단위 행)을 단지별로 묶는다. 호수가 많은 단지부터.
 * 단지명이 없으면 주소로 묶는다 — 이름 없는 행도 재고다(G10의 정신).
 */
export function summarizeInventory(rows: InventoryUnitRow[]): ComplexSummary[] {
  const groups = new Map<string, ComplexSummary>();

  for (const row of rows) {
    const key = row.complexName ?? row.address ?? "위치 미상";
    const entry = groups.get(key) ?? {
      name: row.complexName ?? row.address ?? "위치 미상",
      address: row.address,
      count: 0,
      minArea: null, maxArea: null,
      minDeposit: null, maxDeposit: null,
      minRent: null, maxRent: null,
      supplyTypes: [],
    };

    entry.count += 1;
    if (!entry.address && row.address) entry.address = row.address;

    const area = Number(row.exclusiveArea);
    if (Number.isFinite(area) && area > 0) {
      entry.minArea = entry.minArea === null ? area : Math.min(entry.minArea, area);
      entry.maxArea = entry.maxArea === null ? area : Math.max(entry.maxArea, area);
    }
    // 0원은 미기재일 수 있으므로 범위 계산에서 뺀다 — 0원을 최저가처럼 보여주면 안 된다.
    if (row.deposit !== null && row.deposit > 0) {
      entry.minDeposit = entry.minDeposit === null ? row.deposit : Math.min(entry.minDeposit, row.deposit);
      entry.maxDeposit = entry.maxDeposit === null ? row.deposit : Math.max(entry.maxDeposit, row.deposit);
    }
    if (row.monthlyRent !== null && row.monthlyRent > 0) {
      entry.minRent = entry.minRent === null ? row.monthlyRent : Math.min(entry.minRent, row.monthlyRent);
      entry.maxRent = entry.maxRent === null ? row.monthlyRent : Math.max(entry.maxRent, row.monthlyRent);
    }
    if (row.supplyType && !entry.supplyTypes.includes(row.supplyType)) entry.supplyTypes.push(row.supplyType);

    groups.set(key, entry);
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * 주소로 카카오맵 검색 링크를 만든다. API 키 없이 동작하는 공식 링크 방식이다.
 * PDF 주소에는 구가 빠져 있을 수 있어(예: "시흥대로145길 67") 자치구 힌트를
 * 앞에 붙인다 — 검색 정확도를 위한 보강이지 주소를 지어내는 것이 아니다.
 */
export function mapQuery(address: string, districtHint: string | null): string {
  let query = address.trim();
  if (!/서울/.test(query)) {
    if (districtHint && !query.includes(districtHint)) query = `${districtHint} ${query}`;
    query = `서울 ${query}`;
  }
  return query;
}

export function mapSearchUrl(address: string, districtHint: string | null): string {
  return `https://map.kakao.com/link/search/${encodeURIComponent(mapQuery(address, districtHint))}`;
}
