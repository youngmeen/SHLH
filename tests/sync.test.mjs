import assert from "node:assert/strict";
import test from "node:test";
import { ensureInventory, runSync } from "../app/lib/sync.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 동기화는 수집기와 저장소를 주입받는다. 네트워크와 DB에 의존하는 테스트를 만들지
// 않기 위해서다(SPEC 1.6). 여기서 고정하는 것은 조립 규칙이다.
//  · 소스 하나가 죽어도 나머지가 저장된다
//  · 실패가 sync_run에 남는다 — 없으면 "공고 없음"과 "수집 실패"를 구분할 수 없다(R43)
//  · 포털이 SH 공고의 빈 접수기간·발표일을 채운다
// ─────────────────────────────────────────────────────────────────────────────

function 저장소() {
  const saved = { notices: [], units: [], followUps: [], runs: [] };
  return {
    saved,
    async startRun(trigger) {
      saved.runs.push({ id: saved.runs.length + 1, trigger, status: "running" });
      return saved.runs.length;
    },
    async finishRun(id, patch) {
      Object.assign(saved.runs[id - 1], patch);
    },
    async saveNotices(rows) {
      saved.notices.push(...rows);
      return rows.length;
    },
    async saveUnits(rows) {
      saved.units.push(...rows);
      return rows.length;
    },
    async saveFollowUps(rows) {
      saved.followUps.push(...rows);
      return rows.length;
    },
  };
}

const 마이홈_공고 = {
  source: "myhome",
  sourceId: "21050",
  title: "구리,남양주시 행복주택 예비입주자모집(26.08.05공고)",
  agency: "LH",
  instName: "LH",
  noticeType: "행복주택",
  region: "강북구",
  districts: ["강북구"],
  publishedAt: "2026-08-05",
  applyStart: "2026-08-31",
  applyEnd: "2026-09-02",
  announceAt: "2026-12-07",
  status: "일반공고",
  supplyCount: "168",
  sourceUrl: "https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=1",
  beforeSourceId: null,
  raw: {},
};

const 마이홈_주택 = {
  source: "myhome-notice",
  sourceKey: "21050:1",
  noticeSourceId: "21050",
  complexName: "구리수택",
  sigungu: "강북구",
  supplyType: "행복주택",
  exclusiveArea: null,
  deposit: 37224000,
  monthlyRent: 156000,
  valueSource: "official",
};

const SH_공고 = {
  source: "sh-board",
  sourceId: "308799",
  title: "금천구 1인가구 청년 맞춤형주택(수요자맞춤형) 추가 입주자 모집 공고",
  agency: "SH",
  instName: "서울주택도시개발공사",
  noticeType: "공공임대",
  region: "금천구",
  districts: ["금천구"],
  publishedAt: "2026-08-19",
  applyStart: null,
  applyEnd: null,
  announceAt: null,
  status: null,
  supplyCount: null,
  sourceUrl: "https://www.i-sh.co.kr/app/lay2/program/S1T294C297/www/brd/m_247/view.do?multi_itm_seq=2&seq=308799",
  beforeSourceId: null,
  raw: {},
};

const SH_후속 = {
  source: "sh-board",
  sourceId: "308231",
  title: "2026-1차 희망하우징 당첨자 및 예비자 발표",
  kind: "당첨자",
  publishedAt: "2026-08-10",
  sourceUrl: "https://www.i-sh.co.kr/app/lay2/program/S1T294C297/www/brd/m_247/view.do?multi_itm_seq=2&seq=308231",
  relatedSourceId: null,
  raw: {},
};

const 포털_보충 = new Map([
  [
    "308799",
    {
      shSeq: "308799",
      portalSeq: "1",
      title: "금천구 1인가구 청년 맞춤형주택(수요자맞춤형) 추가 입주자 모집 공고",
      noticeType: "수요자맞춤형",
      publishedAt: "2026-08-19",
      announceAt: null,
      status: "모집중",
      department: "매입주택공급부",
      detailUrl: "https://housing.seoul.go.kr/site/main/sh/publicLease/view?seq=1&cp=1&supplyType=publicLease",
      detail: {
        title: "금천구 1인가구 청년 맞춤형주택(수요자맞춤형) 추가 입주자 모집 공고",
        noticeType: "수요자맞춤형",
        publishedAt: "2026-08-19",
        department: "매입주택공급부",
        applyStart: "2026-08-19",
        applyEnd: "2026-09-17",
        applyDeadlineAt: "2026-09-17T18:00:00+09:00",
        announceAt: "2026-12-11",
        supplyCount: "G밸리하우스-5세대, 소셜믹스형 청년주택-7세대 (총12세대)",
      },
    },
  ],
]);

function 수집기({ myhome, shBoard, portal } = {}) {
  return {
    myhome: myhome ?? (async () => ({ notices: [마이홈_공고], units: [마이홈_주택] })),
    shBoard: shBoard ?? (async () => ({ notices: [SH_공고], followUps: [SH_후속] })),
    portal: portal ?? (async () => 포털_보충),
  };
}

test("세 소스를 모두 읽으면 공고·주택·후속공고가 저장된다", async () => {
  const store = 저장소();
  const result = await runSync({ trigger: "manual", store, collectors: 수집기() });

  assert.equal(result.status, "ok");
  assert.equal(store.saved.notices.length, 2);
  assert.equal(store.saved.units.length, 1);
  assert.equal(store.saved.followUps.length, 1, "후속공고를 버리지 않는다");
  assert.equal(result.saved.notices, 2);
});

test("SH 공고의 빈 접수기간·발표일·모집상태를 포털이 채운다", async () => {
  const store = 저장소();
  await runSync({ trigger: "manual", store, collectors: 수집기() });

  const sh = store.saved.notices.find((notice) => notice.source === "sh-board");
  assert.equal(sh.applyStart, "2026-08-19");
  assert.equal(sh.applyEnd, "2026-09-17");
  assert.equal(sh.applyDeadlineAt, "2026-09-17T18:00:00+09:00");
  assert.equal(sh.announceAt, "2026-12-11");
  assert.equal(sh.status, "모집중");
  assert.equal(sh.supplyCount, "G밸리하우스-5세대, 소셜믹스형 청년주택-7세대 (총12세대)");
});

test("게시판이 준 제목은 포털 값으로 덮지 않는다", async () => {
  const store = 저장소();
  await runSync({ trigger: "manual", store, collectors: 수집기() });

  const sh = store.saved.notices.find((notice) => notice.source === "sh-board");
  assert.equal(sh.title, SH_공고.title, "제목은 게시판이 원본이다");
  assert.equal(sh.sourceUrl, SH_공고.sourceUrl, "링크도 게시판 것을 유지한다");
});

test("소스 하나가 실패해도 나머지를 저장하고 실패를 남긴다", async () => {
  const store = 저장소();
  const result = await runSync({
    trigger: "schedule",
    store,
    collectors: 수집기({
      myhome: async () => {
        throw new Error("마이홈 HTTP 500");
      },
    }),
  });

  assert.equal(result.status, "partial");
  assert.equal(store.saved.notices.length, 1, "SH 공고는 저장돼야 한다");
  assert.equal(store.saved.notices[0].source, "sh-board");

  const myhome = result.sources.find((source) => source.id === "myhome");
  assert.equal(myhome.ok, false);
  assert.match(myhome.message, /마이홈 HTTP 500/);

  const run = store.saved.runs[0];
  assert.equal(run.status, "partial");
  assert.equal(run.trigger, "schedule");
  assert.equal(run.sources.find((source) => source.id === "myhome").ok, false);
  assert.ok(run.finishedAt, "끝난 시각이 남아야 한다");
});

test("전부 실패하면 failed로 남고 아무것도 저장하지 않는다", async () => {
  const store = 저장소();
  const 실패 = async () => {
    throw new Error("네트워크 없음");
  };
  const result = await runSync({
    trigger: "manual",
    store,
    collectors: 수집기({ myhome: 실패, shBoard: 실패 }),
  });

  assert.equal(result.status, "failed");
  assert.equal(store.saved.notices.length, 0);
  assert.equal(store.saved.runs[0].status, "failed");
});

test("SH 게시판이 실패하면 포털은 건너뛴다", async () => {
  const store = 저장소();
  let 포털호출 = 0;
  const result = await runSync({
    trigger: "manual",
    store,
    collectors: 수집기({
      shBoard: async () => {
        throw new Error("SH HTTP 503");
      },
      portal: async () => {
        포털호출 += 1;
        return 포털_보충;
      },
    }),
  });

  assert.equal(포털호출, 0, "붙일 공고가 없으면 포털을 부르지 않는다");
  const portal = result.sources.find((source) => source.id === "housing-portal");
  assert.equal(portal.skipped, true);
  assert.equal(portal.ok, false);
  // 건너뜀과 실패를 같은 상태로 표시하지 않는다(R43).
  assert.match(portal.message, /건너/);
});

test("포털이 실패해도 SH 공고는 저장되고 접수기간은 비어 있다", async () => {
  const store = 저장소();
  const result = await runSync({
    trigger: "manual",
    store,
    collectors: 수집기({
      portal: async () => {
        throw new Error("서울주거포털 HTTP 500");
      },
    }),
  });

  assert.equal(result.status, "partial");
  const sh = store.saved.notices.find((notice) => notice.source === "sh-board");
  // 모르는 값을 만들지 않는다(R44). 화면은 sync_run을 보고 "조회 실패"라고 말한다.
  assert.equal(sh.applyStart, null);
  assert.equal(sh.announceAt, null);
});

test("포털에 없는 SH 공고는 그대로 둔다", async () => {
  const store = 저장소();
  await runSync({
    trigger: "manual",
    store,
    collectors: 수집기({ portal: async () => new Map() }),
  });

  const sh = store.saved.notices.find((notice) => notice.source === "sh-board");
  assert.equal(sh.applyEnd, null);
  assert.equal(sh.status, null);
});

test("sync_run에 시작·종료 시각과 건수가 남는다", async () => {
  const store = 저장소();
  const result = await runSync({ trigger: "schedule", store, collectors: 수집기() });

  const run = store.saved.runs[0];
  assert.equal(run.status, "ok");
  assert.match(result.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(result.finishedAt >= result.startedAt);
  assert.deepEqual(run.sources.map((source) => source.id), ["myhome", "sh-board", "housing-portal"]);
  assert.equal(run.sources.find((source) => source.id === "sh-board").count, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 재고는 공고와 주기가 다르다. 자치구 하나가 0.1~4MB·1~4초이고 매일 바뀌지 않으므로
// 캐시가 살아 있으면 부르지 않는다(SPEC S6).
// ─────────────────────────────────────────────────────────────────────────────

function 재고저장소(ages = {}) {
  const calls = { replaced: [], fetched: [] };
  return {
    calls,
    async inventoryFetchedAt(district) {
      return ages[district] ?? null;
    },
    async replaceDistrictInventory(district, units) {
      calls.replaced.push({ district, count: units.length });
      return units.length;
    },
  };
}

const 재고행 = { source: "myhome-complex", sourceKey: "1:201", sigungu: "금천구", complexName: "G밸리하우스" };

function 재고수집기(calls) {
  return async (district) => {
    calls.fetched.push(district);
    return { units: [{ ...재고행, sigungu: district }], total: 1 };
  };
}

test("재고가 없으면 받아서 자치구 단위로 채운다", async () => {
  const store = 재고저장소();
  const result = await ensureInventory({ districts: ["금천구"], store, fetchInventory: 재고수집기(store.calls) });

  assert.deepEqual(store.calls.fetched, ["금천구"]);
  assert.deepEqual(store.calls.replaced, [{ district: "금천구", count: 1 }]);
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
});

test("캐시가 살아 있으면 부르지 않는다", async () => {
  const 어제 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const store = 재고저장소({ 금천구: 어제 });
  const result = await ensureInventory({ districts: ["금천구"], store, fetchInventory: 재고수집기(store.calls) });

  assert.deepEqual(store.calls.fetched, [], "하루 전 재고를 다시 받지 않는다");
  assert.equal(result.skipped, true);
});

test("캐시가 만료되면 다시 받는다", async () => {
  const 한달전 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const store = 재고저장소({ 금천구: 한달전 });
  await ensureInventory({ districts: ["금천구"], store, fetchInventory: 재고수집기(store.calls) });

  assert.deepEqual(store.calls.fetched, ["금천구"]);
});

test("자치구 하나가 실패해도 나머지를 채운다", async () => {
  const store = 재고저장소();
  const result = await ensureInventory({
    districts: ["금천구", "강북구"],
    store,
    fetchInventory: async (district) => {
      store.calls.fetched.push(district);
      if (district === "금천구") throw new Error("단지정보 HTTP 500");
      return { units: [{ ...재고행, sigungu: district }], total: 1 };
    },
  });

  assert.deepEqual(store.calls.replaced, [{ district: "강북구", count: 1 }]);
  assert.equal(result.ok, false);
  assert.match(result.message, /금천구/);
});

test("서울 자치구가 아닌 값은 부르지 않는다", async () => {
  const store = 재고저장소();
  const result = await ensureInventory({ districts: ["해운대구"], store, fetchInventory: 재고수집기(store.calls) });

  assert.deepEqual(store.calls.fetched, []);
  assert.equal(result.skipped, true);
});

test("한 번에 받을 자치구 수를 제한한다", async () => {
  // 서울 전체 공고 하나면 자치구 25개가 후보가 된다. 자치구당 1~4초라 버튼을 누른
  // 사람이 1분을 기다리게 된다. 남은 자치구는 다음 동기화가 채운다.
  const store = 재고저장소();
  const result = await ensureInventory({
    districts: ["금천구", "강북구", "강동구"],
    store,
    fetchInventory: 재고수집기(store.calls),
    maxDistricts: 2,
  });

  assert.equal(store.calls.fetched.length, 2);
  assert.match(result.message, /남은 자치구/);
});

test("저장 뒤에 실행한 소스도 sync_run에 남는다", async () => {
  // 재고는 공고를 저장한 뒤에 받는다(어느 자치구가 필요한지 그때 알 수 있다).
  // 그 결과가 sync_run에 없으면 화면이 "재고를 못 받았다"는 사실을 말할 수 없다(R43).
  const store = 저장소();
  let 받은자치구 = null;

  const result = await runSync({
    trigger: "schedule",
    store,
    collectors: 수집기(),
    afterSave: async ({ notices }) => {
      받은자치구 = notices.flatMap((notice) => notice.districts);
      return [{ id: "rental-inventory", label: "재고", ok: false, skipped: false, count: 0, message: "HTTP 500", sourceUrl: "https://apis.data.go.kr" }];
    },
  });

  assert.deepEqual(받은자치구, ["강북구", "금천구"]);
  assert.equal(result.status, "partial", "저장 뒤 단계가 실패하면 전체가 정상은 아니다");
  assert.deepEqual(store.saved.runs[0].sources.map((source) => source.id), [
    "myhome",
    "sh-board",
    "housing-portal",
    "rental-inventory",
  ]);
});
