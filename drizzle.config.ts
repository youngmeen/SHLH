import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit CLI는 .env.local을 읽지 않는다. dotenv를 더하지 않고 직접 읽는다.
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((row) => row.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim();
  } catch {
    // .env.local이 없으면 아래에서 던진다.
  }
  throw new Error("DATABASE_URL이 없습니다. .env.local을 확인하세요.");
}

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl() },
});
