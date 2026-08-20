import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.ts";

/** 마이그레이션 SQL에서 `CREATE TABLE "name"` 이름을 모은다. */
function migratedTables(sqlText) {
  return new Set(
    [...sqlText.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([\w.]+)"?/gi)].map((m) => m[1].replace(/^public\./, "")),
  );
}

test("스키마에 정의한 테이블이 마이그레이션에 모두 있다", async () => {
  const files = (await readdir(new URL("../drizzle", import.meta.url))).filter((name) => name.endsWith(".sql"));
  assert.ok(files.length > 0, "drizzle 마이그레이션이 없다. `npm run db:generate`를 먼저 실행할 것");

  const sqlText = (
    await Promise.all(files.sort().map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")))
  ).join("\n");

  const migrated = migratedTables(sqlText);
  const defined = Object.values(schema)
    .filter((value) => is(value, PgTable))
    .map((table) => getTableName(table));

  assert.ok(defined.length > 0, "스키마에 테이블이 없다");
  // 스키마에 테이블을 추가하고 `npm run db:generate`를 잊으면 배포·실행 시점에 깨진다.
  for (const name of defined) {
    assert.ok(migrated.has(name), `${name} 테이블의 마이그레이션이 없다. \`npm run db:generate\` 실행 필요`);
  }
});
