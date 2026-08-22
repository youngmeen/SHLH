import { sql } from "drizzle-orm";
import { bigint, doublePrecision, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * 프로필은 한 사람의 것이므로 항상 한 행이다(id = 1).
 *
 * 필드를 칼럼으로 펼치지 않고 JSON 한 칼럼에 둔다. 자격 판정(Phase 3)에서 생년월일·
 * 청약통장 같은 필드가 더 붙을 예정인데, 1행짜리 표에 필드마다 마이그레이션을 만드는
 * 것은 낭비다. 값 검증은 app/lib/profile.ts의 parseProfile이 담당한다.
 */
export const profile = pgTable("profile", {
  id: integer("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/** 같은 공고를 두 번 알리지 않기 위한 기록. */
export const sentNotice = pgTable("sent_notice", {
  noticeId: text("notice_id").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/** 내가 실제로 지원한 기록. 알림 발송 기록(sent_notice)과는 다른 개념이다. */
export const applied = pgTable("applied", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  noticeId: text("notice_id").notNull(),
  title: text("title").notNull().default(""),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().default(sql`now()`),
  priority: text("priority"),
  result: text("result").notNull().default("미발표"),
  note: text("note").notNull().default(""),
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2. 공고와 공급주택 저장
//
// 설계 근거는 docs/SPEC.md S2와 5절(실측)이다. 요점만 다시 적는다.
//
// · 공고 식별자는 출처마다 다르므로 (source, source_id)를 자연키로 쓴다.
//   마이홈은 pblancId, SH 게시판은 게시물 seq다.
// · 마이홈 모집공고 API는 한 공고를 주택 단위 여러 행으로 준다. 그 행들이
//   housing_unit이 되고, 재고(단지정보 API)에서 온 행도 같은 표에 들어간다.
//   둘은 source로 구분하고, 재고 행은 notice_id가 없다.
// · 원문 스냅샷(raw)은 공고 계열에만 둔다. 재고는 자치구당 1회 호출로 다시
//   받을 수 있고 행이 5만 개라, raw까지 넣으면 무료 티어 500MB를 잠식한다.
// · 날짜는 date, 시각은 timestamptz다. Supabase 서버 타임존은 UTC이므로
//   표시할 때 KST로 바꾼다. 마감이 "9/17 18시"처럼 시각까지 있는 공고가 있다.
// ─────────────────────────────────────────────────────────────────────────────

/** 모집공고 한 건. 후속공고는 follow_up_notice에 따로 둔다. */
export const notice = pgTable(
  "notice",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    source: text("source").notNull(), // myhome | sh-board
    sourceId: text("source_id").notNull(), // pblancId | 게시물 seq
    title: text("title").notNull(),
    agency: text("agency").notNull().default("기타"), // LH | SH | 기타
    instName: text("inst_name"), // 공급기관 원문 (LH · SH공사 · 경상북도개발공사 …)
    noticeType: text("notice_type"), // 출처가 준 유형 표기를 그대로 (DOMAIN 8절)
    noticeTypeNorm: text("notice_type_norm"), // 시스템 정규화 값. 모르면 null
    region: text("region"),
    districts: text("districts").array().notNull().default(sql`'{}'::text[]`),
    publishedAt: text("published_at"), // 공고일 (YYYY-MM-DD)
    applyStart: text("apply_start"),
    applyEnd: text("apply_end"),
    applyDeadlineAt: timestamp("apply_deadline_at", { withTimezone: true }), // 마감 시각까지 아는 경우
    announceAt: text("announce_at"), // 당첨자 발표일
    status: text("status"), // 출처 표기 (일반공고 · 정정공고 · 모집중 · 모집마감 …)
    supplyCount: text("supply_count"), // "5,700호"처럼 원문 그대로
    sourceUrl: text("source_url").notNull(),
    beforeSourceId: text("before_source_id"), // 정정공고가 가리키는 원 공고
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    raw: jsonb("raw"), // 원문 스냅샷 (파싱 규칙을 고쳤을 때 다시 만들 수 있게)
  },
  (table) => [
    uniqueIndex("notice_source_key").on(table.source, table.sourceId),
    index("notice_apply_end").on(table.applyEnd),
    index("notice_first_seen").on(table.firstSeenAt),
  ],
);

/**
 * 주택 한 호(또는 한 주택형).
 *
 * 공고에서 온 행과 재고에서 온 행이 함께 들어간다. 이름이 어긋나 잇지 못하는
 * 경우가 많으므로(SPEC 5절) notice_id는 nullable이고, 억지로 채우지 않는다.
 */
export const housingUnit = pgTable(
  "housing_unit",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    source: text("source").notNull(), // myhome-notice | myhome-complex | lh-complex | soco-youth
    sourceKey: text("source_key"), // 출처 안에서의 식별자 (hsmpSn:styleNm 등)
    noticeId: integer("notice_id").references(() => notice.id, { onDelete: "set null" }),
    instName: text("inst_name"),
    sido: text("sido"),
    sigungu: text("sigungu"),
    complexName: text("complex_name"),
    address: text("address"),
    pnu: text("pnu"),
    unitNo: text("unit_no"), // 호수 또는 주택형 (201 · 21A …)
    supplyType: text("supply_type"),
    houseType: text("house_type"), // 다세대주택 · 아파트 …
    exclusiveArea: numeric("exclusive_area", { precision: 8, scale: 2 }),
    commonArea: numeric("common_area", { precision: 8, scale: 2 }),
    householdCount: integer("household_count"), // 이 주택형/호의 세대수
    totalHousehold: integer("total_household"), // 단지 전체 세대수
    deposit: bigint("deposit", { mode: "number" }),
    monthlyRent: bigint("monthly_rent", { mode: "number" }),
    heating: text("heating"),
    parkingCount: integer("parking_count"),
    builtOn: text("built_on"), // 준공일·입주년월. 출처 형식이 달라 문자열로 둔다
    valueSource: text("value_source").notNull().default("official"), // official | calculated | inferred | unknown
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex("housing_unit_source_key").on(table.source, table.sourceKey),
    index("housing_unit_area_rent").on(table.sigungu, table.exclusiveArea, table.deposit),
    index("housing_unit_notice").on(table.noticeId),
    index("housing_unit_pnu").on(table.pnu),
  ],
);

/**
 * 후속공고. 모집공고 목록에서는 제외하지만 폐기하지 않는다.
 * 과거 경쟁률·커트라인의 유일한 출처다(Phase 6).
 */
export const followUpNotice = pgTable(
  "follow_up_notice",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    title: text("title").notNull(),
    kind: text("kind"), // 결과발표 | 당첨자 | 입주대상자 | 정정 | 기타
    publishedAt: text("published_at"),
    sourceUrl: text("source_url").notNull(),
    relatedSourceId: text("related_source_id"), // 원 모집공고를 가리키는 식별자
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(sql`now()`),
    raw: jsonb("raw"),
  },
  (table) => [uniqueIndex("follow_up_source_key").on(table.source, table.sourceId)],
);

/**
 * 동기화 1회의 기록.
 *
 * 이것이 없으면 "공고가 없음"과 "수집이 실패함"을 구분할 수 없다(R43).
 * 화면은 마지막 성공 시각과 실패한 소스를 이 표에서 읽는다.
 */
export const syncRun = pgTable(
  "sync_run",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`now()`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    trigger: text("trigger").notNull().default("manual"), // manual | schedule
    status: text("status").notNull().default("running"), // running | ok | partial | failed
    sources: jsonb("sources"), // 소스별 { ok, count, message }
    error: text("error"),
  },
  (table) => [index("sync_run_started").on(table.startedAt)],
);

/**
 * 주소 → 좌표 캐시 (지도 표시용 · 2026-08-23).
 *
 * 지오코딩 제공자(Nominatim은 초당 1건 제한)를 같은 주소로 두 번 부르지
 * 않기 위한 영구 캐시다. 좌표가 null인 행은 "찾지 못했다"는 결과 캐시로,
 * 매번 다시 물어보지 않게 한다. 공공주택 주소만 저장하며 프로필과 무관하다(R47).
 */
export const geocode = pgTable("geocode", {
  /** 질의 주소 (서울·자치구 보강을 마친 형태). */
  query: text("query").primaryKey(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  provider: text("provider").notNull(),
  geocodedAt: timestamp("geocoded_at", { withTimezone: true }).notNull().default(sql`now()`),
});
