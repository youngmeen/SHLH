import { PORTAL_LIST_URL, collectPortalSupplements, type PortalSupplement } from "./housing-portal.ts";
import {
  MYHOME_INFO_URL,
  SH_LIST_URL,
  collectMyHomeRecords,
  collectShRecords,
  type MyHomeRecords,
  type ShRecords,
} from "./notice-sources.ts";
import { RENTAL_INVENTORY_API_URL, fetchDistrictInventory } from "./rental-inventory.ts";
import { SEOUL_DISTRICTS, type District, type StoredFollowUp, type StoredHousingUnit, type StoredNotice } from "./notice-types.ts";

/**
 * 수집 → 저장 → 결과 요약. 화면의 [수집] 버튼과 launchd가 **같은 함수**를 부른다
 * (SPEC S6). 두 경로가 갈라지면 스케줄에서만 나는 버그가 생긴다.
 *
 * 수집기와 저장소를 주입받는다. 네트워크·DB에 의존하는 테스트를 만들지 않기 위한
 * 것이고(SPEC 1.6), 덕분에 조립 규칙만 따로 고정할 수 있다.
 *
 * 소스별로 독립 처리한다 — 하나가 죽어도 나머지는 저장한다. 그리고 실행 기록을
 * 남긴다. `sync_run`이 없으면 "공고가 없음"과 "수집이 실패함"을 구분할 수 없다(R43).
 */

export type SyncSourceId = "myhome" | "sh-board" | "housing-portal" | "rental-inventory";
export type SyncTrigger = "manual" | "schedule";
export type SyncStatus = "ok" | "partial" | "failed";

export type SyncSourceResult = {
  id: SyncSourceId;
  label: string;
  ok: boolean;
  /** 부를 이유가 없어 부르지 않았다. 실패와 구분한다(R43). */
  skipped: boolean;
  count: number;
  message: string;
  sourceUrl: string;
};

export type SyncResult = {
  runId: number | null;
  trigger: SyncTrigger;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string;
  sources: SyncSourceResult[];
  saved: { notices: number; units: number; followUps: number };
};

export type SyncCollectors = {
  myhome: () => Promise<MyHomeRecords>;
  shBoard: () => Promise<ShRecords>;
  portal: (shSeqs: string[]) => Promise<Map<string, PortalSupplement>>;
};

export type SyncStore = {
  startRun(trigger: SyncTrigger): Promise<number | null>;
  finishRun(
    runId: number | null,
    patch: { status: SyncStatus; finishedAt: string; sources: SyncSourceResult[]; error: string | null },
  ): Promise<void>;
  saveNotices(notices: StoredNotice[]): Promise<number>;
  saveUnits(units: StoredHousingUnit[]): Promise<number>;
  saveFollowUps(followUps: StoredFollowUp[]): Promise<number>;
};

const SOURCE_LABEL: Record<SyncSourceId, { label: string; sourceUrl: string }> = {
  myhome: { label: "국토교통부 마이홈 모집공고", sourceUrl: MYHOME_INFO_URL },
  "sh-board": { label: "SH 공식 게시판", sourceUrl: SH_LIST_URL },
  "housing-portal": { label: "서울주거포털(SH 접수기간·발표일)", sourceUrl: PORTAL_LIST_URL },
  "rental-inventory": { label: "마이홈 단지정보(자치구 재고)", sourceUrl: RENTAL_INVENTORY_API_URL },
};

function sourceResult(id: SyncSourceId, patch: Partial<SyncSourceResult>): SyncSourceResult {
  return { id, ...SOURCE_LABEL[id], ok: false, skipped: false, count: 0, message: "", ...patch };
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/**
 * 포털이 준 값으로 SH 공고의 빈 칸을 채운다.
 *
 * 게시판이 준 값은 덮지 않는다 — 제목·링크는 게시판이 원본이고, `정정공고` 같은
 * 상태 표기도 포털의 `모집중`보다 잃으면 안 되는 정보다. 유형은 게시판에 없어서
 * 우리가 제목에서 추론한 값이므로, 포털의 공식 청약유형이 있으면 그것을 쓴다.
 */
function applySupplement(notice: StoredNotice, supplement: PortalSupplement): StoredNotice {
  const detail = supplement.detail;
  return {
    ...notice,
    noticeType: supplement.noticeType ?? notice.noticeType,
    applyStart: notice.applyStart ?? detail?.applyStart ?? null,
    applyEnd: notice.applyEnd ?? detail?.applyEnd ?? null,
    applyDeadlineAt: notice.applyDeadlineAt ?? detail?.applyDeadlineAt ?? null,
    announceAt: notice.announceAt ?? detail?.announceAt ?? supplement.announceAt ?? null,
    status: notice.status ?? supplement.status ?? null,
    supplyCount: notice.supplyCount ?? detail?.supplyCount ?? null,
    // 어느 값이 어디서 왔는지 남긴다(S2 · R42). 파싱 규칙을 고쳤을 때 다시 만들 수 있다.
    raw: { board: notice.raw, portal: supplement },
  };
}

export const defaultCollectors: SyncCollectors = {
  myhome: collectMyHomeRecords,
  shBoard: collectShRecords,
  portal: (shSeqs) => collectPortalSupplements(shSeqs),
};

export async function runSync(options: {
  trigger: SyncTrigger;
  store: SyncStore;
  collectors?: Partial<SyncCollectors>;
  /**
   * 저장이 끝난 뒤 실행할 단계. 재고는 어느 자치구가 필요한지 공고를 저장한 뒤에
   * 알 수 있어서 여기서 돈다. 결과는 같은 sync_run에 함께 남는다.
   */
  afterSave?: (context: { notices: StoredNotice[]; saved: SyncResult["saved"] }) => Promise<SyncSourceResult[]>;
}): Promise<SyncResult> {
  const { trigger, store } = options;
  const collectors = { ...defaultCollectors, ...options.collectors };
  const startedAt = new Date().toISOString();
  const runId = await store.startRun(trigger);

  const [myhomeSettled, shSettled] = await Promise.allSettled([collectors.myhome(), collectors.shBoard()]);

  const notices: StoredNotice[] = [];
  const units: StoredHousingUnit[] = [];
  const followUps: StoredFollowUp[] = [];
  const sources: SyncSourceResult[] = [];

  if (myhomeSettled.status === "fulfilled") {
    notices.push(...myhomeSettled.value.notices);
    units.push(...myhomeSettled.value.units);
    sources.push(
      sourceResult("myhome", {
        ok: true,
        count: myhomeSettled.value.notices.length,
        message: `공고 ${myhomeSettled.value.notices.length}건 · 주택 ${myhomeSettled.value.units.length}건`,
      }),
    );
  } else {
    sources.push(sourceResult("myhome", { message: errorMessage(myhomeSettled.reason, "마이홈 수집 실패") }));
  }

  const shNotices = shSettled.status === "fulfilled" ? shSettled.value.notices : [];
  if (shSettled.status === "fulfilled") {
    followUps.push(...shSettled.value.followUps);
    sources.push(
      sourceResult("sh-board", {
        ok: true,
        count: shNotices.length,
        message: `공고 ${shNotices.length}건 · 후속공고 ${shSettled.value.followUps.length}건`,
      }),
    );
  } else {
    sources.push(sourceResult("sh-board", { message: errorMessage(shSettled.reason, "SH 게시판 수집 실패") }));
  }

  // 포털은 SH 공고를 보충하는 소스다. 붙일 공고가 없으면 부르지 않는다.
  if (shNotices.length === 0) {
    sources.push(
      sourceResult("housing-portal", {
        skipped: true,
        message:
          shSettled.status === "fulfilled"
            ? "보충할 SH 공고가 없어 건너뛰었습니다."
            : "SH 게시판 수집이 실패해 건너뛰었습니다.",
      }),
    );
    notices.push(...shNotices);
  } else {
    try {
      const supplements = await collectors.portal(shNotices.map((notice) => notice.sourceId));
      let filled = 0;
      for (const notice of shNotices) {
        const supplement = supplements.get(notice.sourceId);
        if (!supplement) {
          notices.push(notice);
          continue;
        }
        notices.push(applySupplement(notice, supplement));
        filled += 1;
      }
      sources.push(
        sourceResult("housing-portal", { ok: true, count: filled, message: `SH 공고 ${filled}건에 접수기간·발표일을 채웠습니다.` }),
      );
    } catch (reason) {
      // 보충에 실패해도 게시판 공고는 저장한다. 접수기간은 비운 채로 남긴다(R44).
      notices.push(...shNotices);
      sources.push(
        sourceResult("housing-portal", { message: errorMessage(reason, "서울주거포털 조회 실패") }),
      );
    }
  }

  const dataSources = sources.filter((source) => source.id !== "housing-portal");
  const allDataFailed = dataSources.every((source) => !source.ok);

  const saved = { notices: 0, units: 0, followUps: 0 };
  let saveError: string | null = null;
  if (!allDataFailed) {
    try {
      saved.notices = await store.saveNotices(notices);
      saved.units = await store.saveUnits(units);
      saved.followUps = await store.saveFollowUps(followUps);
    } catch (reason) {
      saveError = errorMessage(reason, "저장 실패");
    }
  }

  if (!allDataFailed && !saveError && options.afterSave) {
    try {
      sources.push(...(await options.afterSave({ notices, saved })));
    } catch (reason) {
      sources.push(sourceResult("rental-inventory", { message: errorMessage(reason, "저장 뒤 단계 실패") }));
    }
  }

  // 건너뛴 소스는 성공 여부 계산에서 뺀다. 부를 이유가 없던 것을 실패로 세지 않는다.
  const graded = sources.filter((source) => !source.skipped);
  const status: SyncStatus =
    allDataFailed || saveError ? "failed" : graded.every((source) => source.ok) ? "ok" : "partial";

  const finishedAt = new Date().toISOString();
  await store.finishRun(runId, { status, finishedAt, sources, error: saveError });

  return { runId, trigger, status, startedAt, finishedAt, sources, saved };
}

// ─────────────────────────────────────────────────────────────────────────────
// 재고 동기화
//
// 공고와 주기가 다르다. 자치구 하나가 0.1~4MB·1~4초이고 재고는 매일 바뀌지 않는다.
// 그래서 캐시가 살아 있으면 부르지 않고, 공고에 새 자치구가 등장하거나 캐시가
// 만료될 때만 받는다(SPEC S6).
//
// 받은 재고는 자치구 단위로 통째 교체한다. 호수 키가 일정하지 않아(`styleNm`이
// 호수인 곳과 면적 타입인 곳이 섞여 있다) 행 단위로 갱신하면 사라진 주택이 남는다.
// ─────────────────────────────────────────────────────────────────────────────

export type InventoryStore = {
  /** 그 자치구 재고를 마지막으로 받은 시각. 없으면 null. */
  inventoryFetchedAt(district: District): Promise<string | null>;
  replaceDistrictInventory(district: District, units: StoredHousingUnit[]): Promise<number>;
};

const INVENTORY_MAX_AGE_DAYS = 14;
const INVENTORY_MAX_DISTRICTS_PER_RUN = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function ensureInventory(options: {
  districts: string[];
  store: InventoryStore;
  fetchInventory?: (district: District) => Promise<{ units: StoredHousingUnit[]; total: number }>;
  maxAgeDays?: number;
  /** 한 번의 동기화에서 받을 자치구 수. 나머지는 다음 동기화가 채운다. */
  maxDistricts?: number;
}): Promise<SyncSourceResult> {
  const fetchInventory = options.fetchInventory ?? fetchDistrictInventory;
  const maxAge = (options.maxAgeDays ?? INVENTORY_MAX_AGE_DAYS) * DAY_MS;
  const targets = [...new Set(options.districts)].filter((district): district is District =>
    SEOUL_DISTRICTS.includes(district as District),
  );

  const stale: District[] = [];
  for (const district of targets) {
    const fetchedAt = await options.store.inventoryFetchedAt(district);
    if (!fetchedAt || Date.now() - Date.parse(fetchedAt) > maxAge) stale.push(district);
  }

  // 자치구당 1~4초·0.1~4MB다. 서울 전체 공고 하나면 후보가 25개가 되므로 한 번에 받는
  // 수를 끊는다. 캐시가 없는 자치구는 다음 동기화가 이어서 채운다.
  const budget = options.maxDistricts ?? INVENTORY_MAX_DISTRICTS_PER_RUN;
  const pending = stale.slice(budget);
  const picked = stale.slice(0, budget);

  if (picked.length === 0) {
    return sourceResult("rental-inventory", {
      skipped: true,
      message:
        targets.length === 0
          ? "받을 자치구가 없어 건너뛰었습니다."
          : `자치구 ${targets.length}개의 재고가 아직 유효해 건너뛰었습니다.`,
    });
  }

  let count = 0;
  const failures: string[] = [];
  for (const district of picked) {
    try {
      const { units } = await fetchInventory(district);
      count += await options.store.replaceDistrictInventory(district, units);
    } catch (reason) {
      failures.push(`${district}: ${errorMessage(reason, "재고 수집 실패")}`);
    }
  }

  const rest = pending.length > 0 ? ` 남은 자치구 ${pending.length}개는 다음 동기화가 받습니다.` : "";
  return sourceResult("rental-inventory", {
    ok: failures.length === 0,
    count,
    message:
      failures.length === 0
        ? `자치구 ${picked.length}개 · 주택 ${count}건을 새로 받았습니다.${rest}`
        : `일부 자치구를 받지 못했습니다 — ${failures.join(" / ")}${rest}`,
  });
}
