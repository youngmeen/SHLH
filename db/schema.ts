import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 프로필은 한 사람의 것이므로 항상 한 행이다(id = 1).
 *
 * 12개 필드를 칼럼으로 펼치지 않고 JSON 한 칼럼에 둔다. 자격 창 추적 단계에서
 * 청약통장 가입기간·무주택기간 같은 필드가 더 붙을 예정인데, 1행짜리 표에
 * 필드마다 마이그레이션을 만드는 것은 낭비다. 값 검증은 app/lib/profile.ts의
 * parseProfile이 담당한다.
 */
export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** 같은 공고를 두 번 알리지 않기 위한 기록. */
export const sentNotice = sqliteTable("sent_notice", {
  noticeId: text("notice_id").primaryKey(),
  sentAt: text("sent_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** 내가 실제로 지원한 기록. 알림 발송 기록(sent_notice)과는 다른 개념이다. */
export const applied = sqliteTable("applied", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  noticeId: text("notice_id").notNull(),
  title: text("title").notNull().default(""),
  appliedAt: text("applied_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  priority: text("priority"),
  result: text("result").notNull().default("미발표"),
  note: text("note").notNull().default(""),
});

/**
 * 로컬 실행용 테이블 생성문.
 *
 * 이 템플릿은 drizzle 마이그레이션을 배포 시 플랫폼이 적용하는 모델이라
 * 로컬 D1에는 테이블을 만들 경로가 없다. 배포하지 않기로 했으므로 앱이 직접
 * 보장한다. 위의 drizzle 정의와 반드시 같은 모양을 유지할 것 —
 * 어긋나면 질의가 런타임에 깨진다.
 */
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS profile (
     id INTEGER PRIMARY KEY,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS sent_notice (
     notice_id TEXT PRIMARY KEY,
     sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS applied (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     notice_id TEXT NOT NULL,
     title TEXT NOT NULL DEFAULT '',
     applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     priority TEXT,
     result TEXT NOT NULL DEFAULT '미발표',
     note TEXT NOT NULL DEFAULT ''
   )`,
];
