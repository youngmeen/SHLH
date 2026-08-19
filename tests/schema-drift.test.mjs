import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { SCHEMA_STATEMENTS } from "../db/schema.ts";

/** `CREATE TABLE [IF NOT EXISTS] name ( col ..., col ... )` → { table: [칼럼] } */
function tableColumns(sqlText) {
  const tables = {};
  const pattern = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*?)\n?\s*\);?/gi;
  for (const [, table, body] of sqlText.matchAll(pattern)) {
    tables[table] = body
      .split(",")
      .map((line) => line.trim())
      .filter((line) => line && !/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK)\b/i.test(line))
      .map((line) => line.match(/^[`"]?(\w+)[`"]?/)?.[1])
      .filter((name) => name !== undefined)
      .sort();
  }
  return tables;
}

test("로컬 생성문과 drizzle 마이그레이션의 테이블·칼럼이 일치한다", async () => {
  const files = (await readdir(new URL("../drizzle", import.meta.url))).filter((name) => name.endsWith(".sql"));
  assert.ok(files.length > 0, "drizzle 마이그레이션이 없다. `npm run db:generate`를 먼저 실행할 것");

  const generated = await Promise.all(
    files.sort().map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")),
  );

  // 손으로 쓴 로컬 생성문(db/schema.ts)과 drizzle 산출물이 어긋나면
  // 로컬에서는 테이블이 만들어지는데 질의가 런타임에 깨진다.
  assert.deepEqual(tableColumns(SCHEMA_STATEMENTS.join(";\n")), tableColumns(generated.join("\n")));
});
