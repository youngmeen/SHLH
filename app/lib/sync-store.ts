import { and, desc, eq, getTableColumns, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getDb } from "../../db/index.ts";
import { applied, followUpNotice, housingUnit, notice, profile, sentNotice, syncRun } from "../../db/schema.ts";
import type { StoredFollowUp, StoredHousingUnit, StoredNotice, District } from "./notice-types.ts";
import type { InventoryStore, SyncStore, SyncSourceResult, SyncStatus, SyncTrigger } from "./sync.ts";

/**
 * Supabase Postgres에 쓰는 저장소. sync.ts가 요구하는 계약(SyncStore·InventoryStore)의
 * 실제 구현이다. 조립 규칙은 sync.ts에 있고 여기는 SQL만 담당한다.
 *
 * 지키는 것
 * · 같은 공고를 다시 봐도 **최초 확인 시각(first_seen_at)은 덮지 않는다.** 언제부터
 *   보였는지가 알림·경쟁률 판단의 기준이다.
 * · 재고는 자치구 단위로 통째 교체한다. 호수 키가 일정하지 않아 행 단위로 갱신하면
 *   사라진 주택이 남는다(SPEC 5절).
 * · 한 번에 넣는 행 수를 끊는다. 자치구 하나가 5,000행이고 Postgres 파라미터 상한이
 *   있어 통째로 넣으면 실패한다.
 */

// 행 하나가 20여 칼럼이므로 500행이면 파라미터 1만 개 남짓이다. 상한(65535)에 여유가 있다.
const INSERT_CHUNK = 500;

function chunked<T>(rows: T[], size = INSERT_CHUNK) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

/**
 * 충돌 시 새로 들어온 값으로 갱신할 칼럼 집합.
 *
 * `excluded`는 Postgres가 주는 "넣으려던 행"이다. 칼럼을 하나씩 적으면 스키마가
 * 늘어날 때 조용히 빠지므로 표에서 읽고 제외 목록만 관리한다.
 */
function refreshExcept<T extends PgTable>(table: T, skip: string[]): Record<string, SQL> {
  return Object.fromEntries(
    Object.entries(getTableColumns(table))
      .filter(([key]) => !skip.includes(key))
      .map(([key, column]) => [key, sql`excluded.${sql.identifier(column.name)}`]),
  );
}

function noticeRow(row: StoredNotice) {
  return {
    source: row.source,
    sourceId: row.sourceId,
    title: row.title,
    agency: row.agency,
    instName: row.instName,
    noticeType: row.noticeType,
    region: row.region,
    districts: row.districts,
    publishedAt: row.publishedAt,
    applyStart: row.applyStart,
    applyEnd: row.applyEnd,
    applyDeadlineAt: row.applyDeadlineAt ? new Date(row.applyDeadlineAt) : null,
    announceAt: row.announceAt,
    status: row.status,
    supplyCount: row.supplyCount,
    sourceUrl: row.sourceUrl,
    beforeSourceId: row.beforeSourceId,
    updatedAt: new Date(),
    raw: row.raw ?? null,
  };
}

/** numeric 칼럼은 문자열로 넣는다. 부동소수로 왕복하면 면적이 미세하게 달라진다. */
function decimal(value: number | null) {
  return value === null || value === undefined ? null : String(value);
}

function unitRow(row: StoredHousingUnit, noticeId: number | null) {
  return {
    source: row.source,
    sourceKey: row.sourceKey,
    noticeId,
    instName: row.instName ?? null,
    sido: row.sido ?? null,
    sigungu: row.sigungu ?? null,
    complexName: row.complexName ?? null,
    address: row.address ?? null,
    pnu: row.pnu ?? null,
    unitNo: row.unitNo ?? null,
    supplyType: row.supplyType ?? null,
    houseType: row.houseType ?? null,
    exclusiveArea: decimal(row.exclusiveArea ?? null),
    commonArea: decimal(row.commonArea ?? null),
    householdCount: row.householdCount ?? null,
    totalHousehold: row.totalHousehold ?? null,
    deposit: row.deposit ?? null,
    monthlyRent: row.monthlyRent ?? null,
    heating: row.heating ?? null,
    parkingCount: row.parkingCount ?? null,
    builtOn: row.builtOn ?? null,
    valueSource: row.valueSource ?? "official",
    fetchedAt: new Date(),
  };
}

/** 주택이 어느 공고 출처에서 나왔는지. 재고에서 온 행은 공고에 속하지 않는다. */
const UNIT_TO_NOTICE_SOURCE: Record<string, "myhome" | "sh-board" | undefined> = {
  "myhome-notice": "myhome",
};

export function createSyncStore(db = getDb()): SyncStore & InventoryStore {
  return {
    async startRun(trigger: SyncTrigger) {
      const [row] = await db.insert(syncRun).values({ trigger, status: "running" }).returning({ id: syncRun.id });
      return row?.id ?? null;
    },

    async finishRun(
      runId: number | null,
      patch: { status: SyncStatus; finishedAt: string; sources: SyncSourceResult[]; error: string | null },
    ) {
      if (runId === null) return;
      await db
        .update(syncRun)
        .set({
          status: patch.status,
          finishedAt: new Date(patch.finishedAt),
          sources: patch.sources,
          error: patch.error,
        })
        .where(eq(syncRun.id, runId));
    },

    async saveNotices(rows: StoredNotice[]) {
      if (rows.length === 0) return 0;
      let saved = 0;
      for (const chunk of chunked(rows.map(noticeRow))) {
        await db
          .insert(notice)
          .values(chunk)
          .onConflictDoUpdate({
            target: [notice.source, notice.sourceId],
            // first_seen_at은 덮지 않는다. 처음 본 시각이 알림 판단의 기준이다.
            set: refreshExcept(notice, ["id", "firstSeenAt", "source", "sourceId", "noticeTypeNorm"]),
          });
        saved += chunk.length;
      }
      return saved;
    },

    async saveUnits(rows: StoredHousingUnit[]) {
      if (rows.length === 0) return 0;

      // 주택을 공고에 붙이려면 공고의 DB id가 필요하다. 방금 저장한 공고에서 찾아온다.
      const wanted = new Map<string, string[]>();
      for (const row of rows) {
        const noticeSource = UNIT_TO_NOTICE_SOURCE[row.source];
        if (!noticeSource || !row.noticeSourceId) continue;
        const list = wanted.get(noticeSource) ?? [];
        list.push(row.noticeSourceId);
        wanted.set(noticeSource, list);
      }

      const noticeIds = new Map<string, number>();
      for (const [source, sourceIds] of wanted) {
        const found = await db
          .select({ id: notice.id, sourceId: notice.sourceId })
          .from(notice)
          .where(and(eq(notice.source, source), inArray(notice.sourceId, [...new Set(sourceIds)])));
        for (const row of found) noticeIds.set(`${source}:${row.sourceId}`, row.id);
      }

      const values = rows.map((row) => {
        const noticeSource = UNIT_TO_NOTICE_SOURCE[row.source];
        const key = noticeSource && row.noticeSourceId ? `${noticeSource}:${row.noticeSourceId}` : null;
        // 잇지 못하면 잇지 않은 채로 둔다. 억지로 다른 공고에 붙이지 않는다(R44).
        return unitRow(row, key ? noticeIds.get(key) ?? null : null);
      });

      let saved = 0;
      for (const chunk of chunked(values)) {
        await db
          .insert(housingUnit)
          .values(chunk)
          .onConflictDoUpdate({
            target: [housingUnit.source, housingUnit.sourceKey],
            set: refreshExcept(housingUnit, ["id", "source", "sourceKey"]),
          });
        saved += chunk.length;
      }
      return saved;
    },

    async saveFollowUps(rows: StoredFollowUp[]) {
      if (rows.length === 0) return 0;
      let saved = 0;
      for (const chunk of chunked(rows)) {
        await db
          .insert(followUpNotice)
          .values(chunk.map((row) => ({ ...row, raw: row.raw ?? null })))
          .onConflictDoUpdate({
            target: [followUpNotice.source, followUpNotice.sourceId],
            set: refreshExcept(followUpNotice, ["id", "firstSeenAt", "source", "sourceId"]),
          });
        saved += chunk.length;
      }
      return saved;
    },

    async inventoryFetchedAt(district: District) {
      const [row] = await db
        .select({ fetchedAt: sql<string | null>`max(${housingUnit.fetchedAt})` })
        .from(housingUnit)
        .where(and(eq(housingUnit.source, "myhome-complex"), eq(housingUnit.sigungu, district)));
      return row?.fetchedAt ? new Date(row.fetchedAt).toISOString() : null;
    },

    async replaceDistrictInventory(district: District, units: StoredHousingUnit[]) {
      // 자치구 단위 통째 교체. 사라진 주택을 남기지 않는 유일한 방법이다.
      return db.transaction(async (tx) => {
        await tx
          .delete(housingUnit)
          .where(and(eq(housingUnit.source, "myhome-complex"), eq(housingUnit.sigungu, district)));

        let saved = 0;
        for (const chunk of chunked(units.map((unit) => unitRow(unit, null)))) {
          await tx
            .insert(housingUnit)
            .values(chunk)
            .onConflictDoUpdate({
              target: [housingUnit.source, housingUnit.sourceKey],
              set: refreshExcept(housingUnit, ["id", "source", "sourceKey"]),
            });
          saved += chunk.length;
        }
        return saved;
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 읽기. 화면과 내보내기가 쓴다.
// ─────────────────────────────────────────────────────────────────────────────

/** 마지막 실행과 마지막 성공을 함께 준다. 둘이 다르면 화면이 그렇게 말해야 한다(R43). */
export async function readSyncSummary(db = getDb()) {
  const [last] = await db.select().from(syncRun).orderBy(desc(syncRun.startedAt)).limit(1);
  const [lastOk] = await db
    .select({ startedAt: syncRun.startedAt, finishedAt: syncRun.finishedAt })
    .from(syncRun)
    .where(ne(syncRun.status, "failed"))
    .orderBy(desc(syncRun.startedAt))
    .limit(1);

  return {
    last: last ?? null,
    lastSuccessAt: lastOk?.finishedAt ?? null,
    /** 한 번도 돌지 않았다. "공고 없음"과 구분해서 표시한다. */
    neverRan: !last,
  };
}

export async function readStoredNotices(limit = 200, db = getDb()) {
  return db.select().from(notice).orderBy(desc(notice.publishedAt), desc(notice.firstSeenAt)).limit(limit);
}

export async function readNoticeUnits(noticeId: number, db = getDb()) {
  return db.select().from(housingUnit).where(eq(housingUnit.noticeId, noticeId));
}

/** 그 자치구의 재고. 공고에 잇지 못한 주택도 여기서 눈으로 확인할 수 있다. */
export async function readDistrictInventory(district: string, limit = 500, db = getDb()) {
  return db
    .select()
    .from(housingUnit)
    .where(and(eq(housingUnit.source, "myhome-complex"), eq(housingUnit.sigungu, district)))
    .limit(limit);
}

/**
 * 내보내기(S4). 무료 티어는 백업이 없고 1주 방치하면 일시정지된다.
 *
 * 재고는 넣지 않는다 — 자치구당 1회 호출로 다시 받을 수 있고, 5만 행을 백업 파일에
 * 넣으면 파일이 쓸데없이 커진다.
 */
export async function readExportDump(db = getDb()) {
  const [profileRows, appliedRows, sentRows, noticeRows, unitRows, followUpRows, runRows] = await Promise.all([
    db.select().from(profile),
    db.select().from(applied),
    db.select().from(sentNotice),
    db.select().from(notice),
    db.select().from(housingUnit).where(ne(housingUnit.source, "myhome-complex")),
    db.select().from(followUpNotice),
    db.select().from(syncRun).orderBy(desc(syncRun.startedAt)).limit(200),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    schema: "jib-alim/phase2",
    note: "재고(myhome-complex)는 다시 받을 수 있어 제외했습니다.",
    profile: profileRows,
    applied: appliedRows,
    sentNotice: sentRows,
    notice: noticeRows,
    housingUnit: unitRows,
    followUpNotice: followUpRows,
    syncRun: runRows,
  };
}

/** 화면의 공고 id(`MYHOME-21050`·`SH-308799`)로 저장된 공고를 찾는다. */
export async function readNoticeBySource(source: string, sourceId: string, db = getDb()) {
  const [row] = await db
    .select()
    .from(notice)
    .where(and(eq(notice.source, source), eq(notice.sourceId, sourceId)))
    .limit(1);
  return row ?? null;
}

export async function readInventoryFetchedAt(district: string, db = getDb()) {
  const [row] = await db
    .select({ fetchedAt: sql<string | null>`max(${housingUnit.fetchedAt})`, count: sql<number>`count(*)::int` })
    .from(housingUnit)
    .where(and(eq(housingUnit.source, "myhome-complex"), eq(housingUnit.sigungu, district)));
  return { fetchedAt: row?.fetchedAt ?? null, count: Number(row?.count ?? 0) };
}
