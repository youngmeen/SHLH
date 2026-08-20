import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

/**
 * Supabase Postgres 연결.
 *
 * 접속 문자열은 서버에서만 읽는다(REQUIREMENTS R45). Supabase 신규 프로젝트의 직접
 * 연결(`db.<ref>.supabase.co`)은 IPv6 전용이므로 IPv4 경로가 있는 Connection Pooler를
 * 쓴다. Session mode(5432)는 prepared statement를 지원하므로 추가 설정이 필요 없다.
 *
 * 개발 중 모듈이 다시 평가되어도 연결이 쌓이지 않도록 전역에 한 번만 만든다.
 */
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  globalForDb.__sql ??= postgres(url, { max: 4, idle_timeout: 20, connect_timeout: 15 });
  return globalForDb.__sql;
}

export function getDb() {
  return drizzle(client(), { schema });
}
