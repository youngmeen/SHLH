import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 이 프로젝트: 빌드 산출물과 도구 상태
    "drizzle/**",
    // vinext·Workers 시절의 산출물. 런타임을 Node로 옮긴 뒤 남은 것이라 검사하지 않는다.
    "dist/**",
    ".vinext/**",
    ".wrangler/**",
    "backups/**",
  ]),
]);

export default eslintConfig;
