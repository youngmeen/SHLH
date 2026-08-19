import { getWorkerBindings } from "./env";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  const env = getWorkerBindings();
  if (!env?.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

// 아이소레이트마다 한 번만 만든다. 실패하면 다음 요청에서 다시 시도하도록 비운다.
let ready: Promise<void> | null = null;

/**
 * 테이블이 있는 D1 핸들을 돌려준다.
 *
 * 배포하지 않는 동안 로컬 D1에는 마이그레이션을 적용할 경로가 없으므로
 * 앱이 직접 테이블을 보장한다. 문장은 모두 `IF NOT EXISTS`라 반복 실행이 안전하다.
 */
export async function getReadyDb() {
  const db = getDb();
  ready ??= (async () => {
    for (const statement of schema.SCHEMA_STATEMENTS) {
      await db.run(sql.raw(statement));
    }
  })().catch((reason) => {
    ready = null;
    throw reason;
  });
  await ready;
  return db;
}
