import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the live housing notice monitor", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /집알림/);
  assert.match(html, /실데이터 BETA/);
  assert.match(html, /서울 공공임대 공고 모니터/);
  assert.match(html, /2026년 청년 전세임대 1순위 입주자 수시모집/);
  assert.match(html, /내 조건으로 확인할 공고가/);
  assert.match(html, /조건 추천/);
  assert.match(html, /전체 공고/);
  assert.match(html, /우선 확인할 공고/);
  assert.match(html, /7,000호/);
  assert.match(html, /공식 경쟁률/);
  assert.match(html, /공고문 핵심 내용/);
  assert.doesNotMatch(html, /2026 다자녀 전세임대 입주자 수시모집 공고/);
  assert.doesNotMatch(html, /2026년 1차 일반주택형 미리내집/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("keeps live loading and notification interactions in source", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /^"use client";/);
  assert.match(page, /fetch\(`\/api\/notices/);
  assert.match(page, /function statusClass/);
  assert.match(page, /function simulateTelegram/);
  assert.match(page, /혼인 상태/);
  assert.match(page, /막내 생년월일/);
  assert.match(page, /한부모 가구/);
  assert.match(page, /evaluateAudience/);
  assert.match(page, /fit\.status !== "mismatch"/);
  assert.match(page, /내 조건으로 공고 찾기/);
  assert.match(page, /\/api\/notice-detail/);
  assert.match(page, /지원 검토 추천/);
  assert.doesNotMatch(page, /DEMO-SH-|가상 공고/);
  assert.match(layout, /서울 LH·SH 임대주택 공고 모니터/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("app/_sites-preview", root)));
});
