import { NOTICE_FETCH_TIMEOUT_MS } from "./notice-http.ts";
import { SEOUL_BRTC_CODE, SEOUL_SIGUNGU_CODE, type District, type StoredHousingUnit } from "./notice-types.ts";

/**
 * 마이홈 공공임대주택 단지정보 API.
 *
 * 모집공고 API가 주지 않는 값을 여기서 얻는다 — 전용면적·호수·도로명주소·PNU.
 * SH가 모집공고 API에는 참여하지 않지만 이 API에는 `insttNm = "SH공사"`로 들어
 * 있어서, SH 매입임대의 주택 재고를 유일하게 얻는 경로다(SPEC 5절).
 *
 * 특징
 * · 행 단위는 (단지 × 주택형 × 임대조건)이다. `styleNm` 표기가 일정하지 않다 —
 *   `201`·`202`처럼 호수인 곳도 있고 `35`·`15`처럼 면적 기반 타입인 곳도 있다.
 *   같은 단지·같은 주택형에 임대조건만 다른 행이 여러 개 온다(실측).
 * · `numOfRows`에 상한이 없어 자치구 하나를 1회 호출로 받는다(가장 큰 강동구
 *   5,025행이 3.9MB·약 4초).
 * · 재고는 매일 바뀌지 않는다. 호출은 캐시 만료나 새 자치구가 등장할 때만 한다.
 */
export const RENTAL_INVENTORY_API_URL = "https://apis.data.go.kr/1613000/HWSPR04/rentalHouseGwList";

// 자치구 최대가 약 5천 행이므로 한 번에 다 받는다. 모자라면 아래 루프가 다음 장을 읽는다.
const PAGE_SIZE = 6000;

type InventoryItem = {
  hsmpSn?: number | string;
  insttNm?: string;
  brtcNm?: string;
  signguNm?: string;
  hsmpNm?: string;
  rnAdres?: string;
  pnu?: string;
  competDe?: string;
  hshldCo?: number | string;
  suplyTyNm?: string;
  styleNm?: string;
  suplyPrvuseAr?: number | string;
  suplyCmnuseAr?: number | string;
  houseTyNm?: string;
  heatMthdDetailNm?: string;
  elvtrInstlAtNm?: string;
  parkngCo?: number | string;
  bassRentGtn?: number | string;
  bassMtRntchrg?: number | string;
};

type InventoryPayload = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { item?: InventoryItem | InventoryItem[]; totalCount?: string | number };
  };
};

function text(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function num(value: unknown) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const parsed = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseInventory(payload: InventoryPayload): { units: StoredHousingUnit[]; total: number } {
  const header = payload.response?.header;
  if (header?.resultCode !== "00") throw new Error(header?.resultMsg || "단지정보 API 오류");

  const raw = payload.response?.body?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

  // 완전히 같은 행이 여러 개 오는 경우가 있다(실측: 자치구당 1~4건). 어느 쪽이 실제
  // 세대인지 알 수 없으므로 버리지 않고 둘 다 남기고, 키에만 순번을 붙인다. 재고는
  // 자치구 단위로 전체 교체하므로 키는 한 배치 안에서만 유일하면 된다.
  const seen = new Map<string, number>();
  const units = items.map((item): StoredHousingUnit => {
    const complexSn = text(item.hsmpSn) ?? "0";
    const unitNo = text(item.styleNm);
    const area = num(item.suplyPrvuseAr);
    const commonArea = num(item.suplyCmnuseAr);
    const deposit = num(item.bassRentGtn);
    const monthlyRent = num(item.bassMtRntchrg);
    const base = [complexSn, unitNo ?? "-", area ?? "-", text(item.suplyTyNm) ?? "-", deposit ?? "-", monthlyRent ?? "-", commonArea ?? "-"].join(":");
    const nth = (seen.get(base) ?? 0) + 1;
    seen.set(base, nth);

    return {
      source: "myhome-complex",
      sourceKey: nth === 1 ? base : `${base}#${nth}`,
      noticeSourceId: null, // 재고는 특정 공고에 속하지 않는다. 잇지 못하면 잇지 않는다
      instName: text(item.insttNm),
      sido: text(item.brtcNm),
      sigungu: text(item.signguNm),
      complexName: text(item.hsmpNm),
      address: text(item.rnAdres),
      pnu: text(item.pnu),
      unitNo,
      supplyType: text(item.suplyTyNm),
      houseType: text(item.houseTyNm),
      exclusiveArea: area,
      commonArea,
      householdCount: num(item.hshldCo),
      totalHousehold: null, // 이 API는 단지 총세대를 주지 않는다
      deposit,
      monthlyRent,
      heating: text(item.heatMthdDetailNm),
      parkingCount: num(item.parkngCo),
      builtOn: text(item.competDe),
      valueSource: "official",
    };
  });

  return { units, total: Number(payload.response?.body?.totalCount ?? units.length) };
}

function apiKey() {
  const key = process.env.DATA_GO_KR_API_KEY ?? process.env.MOLIT_MYHOME_API_KEY;
  if (!key) throw new Error("DATA_GO_KR_API_KEY가 설정되지 않았습니다.");
  return key.includes("%") ? key : encodeURIComponent(key);
}

/** 자치구 하나의 재고를 전부 받는다. 보통 1회 호출로 끝난다. */
export async function fetchDistrictInventory(district: District): Promise<{ units: StoredHousingUnit[]; total: number }> {
  const signguCode = SEOUL_SIGUNGU_CODE[district];
  if (!signguCode) throw new Error(`시군구 코드를 모르는 자치구: ${district}`);

  const key = apiKey();
  const collected: StoredHousingUnit[] = [];
  let total = 0;

  for (let pageNo = 1; pageNo <= 10; pageNo += 1) {
    const url =
      `${RENTAL_INVENTORY_API_URL}?serviceKey=${key}&pageNo=${pageNo}&numOfRows=${PAGE_SIZE}` +
      `&brtcCode=${SEOUL_BRTC_CODE}&signguCode=${signguCode}`;
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(NOTICE_FETCH_TIMEOUT_MS * 3) });
    if (!response.ok) throw new Error(`단지정보 HTTP ${response.status}`);

    const page = parseInventory((await response.json()) as InventoryPayload);
    total = page.total;
    collected.push(...page.units);
    if (page.units.length === 0 || collected.length >= total) break;
  }

  return { units: collected, total };
}
