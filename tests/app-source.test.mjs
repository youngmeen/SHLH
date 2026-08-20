import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { initialNoticeFeed } from "../app/lib/initial-notice-feed.ts";
import { SEOUL_DISTRICTS } from "../app/lib/notice-types.ts";

// 화면 문구는 검증하지 않는다. UI를 고칠 때마다 깨지고, 깨져도 알려주는 것이 없다.
// 대신 구조(클라이언트 컴포넌트인지, 어떤 API를 부르는지, 가짜 데이터가 섞이지 않았는지)와
// 초기 스냅샷 데이터의 일관성을 고정한다.

test("초기 스냅샷이 형식과 자치구 규칙을 지킨다", () => {
  assert.ok(initialNoticeFeed.notices.length > 0, "스냅샷 공고가 없다");
  assert.match(initialNoticeFeed.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);

  for (const notice of initialNoticeFeed.notices) {
    assert.ok(notice.id && notice.title, "공고에 id·제목이 있어야 한다");
    assert.ok(["LH", "SH", "기타"].includes(notice.agency));
    assert.ok(notice.districts.length > 0, `${notice.id}: 자치구가 비었다`);
    for (const district of notice.districts) {
      assert.ok(SEOUL_DISTRICTS.includes(district), `${notice.id}: 서울 자치구가 아니다 (${district})`);
    }
    // 지역이 '서울 전체'면 자치구를 특정하지 않았다는 뜻이므로 25개 전체여야 한다.
    if (notice.region.startsWith("서울 전체")) {
      assert.equal(notice.districts.length, SEOUL_DISTRICTS.length, `${notice.id}: '서울 전체'인데 자치구가 일부다`);
    }
    assert.doesNotMatch(notice.title, /DEMO|가상|테스트/);
  }

  for (const source of initialNoticeFeed.sources) {
    assert.ok(["myhome", "sh-board"].includes(source.id));
    assert.match(source.sourceUrl, /^https:\/\//);
  }
});

test("화면이 실데이터 경로를 유지한다", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /^"use client";/, "클라이언트 컴포넌트여야 한다");
  assert.match(page, /\/api\/notices/, "공고를 API에서 받아야 한다");
  assert.match(page, /\/api\/notice-detail/, "상세를 API에서 받아야 한다");
  assert.match(page, /evaluateAudience/, "조건 판정을 공용 함수로 해야 한다");
  assert.doesNotMatch(page, /DEMO-SH-|가상 공고/, "가짜 공고가 섞이면 안 된다");
});

test("메타데이터와 공개 자산이 있다", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /집알림/);
  assert.match(layout, /og\.png/);
  await access(new URL("../public/og.png", import.meta.url));
});
