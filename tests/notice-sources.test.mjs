import assert from "node:assert/strict";
import test from "node:test";
import { mergeShPages, parseMyHomeNotices, parseShNotices } from "../app/lib/notice-sources.ts";

/** SH 게시판 행 하나를 만든다. 실제 목록 HTML 구조를 따른다. */
function shRow(seq, title, department = "공공주택공급부", date = "2026-08-19") {
  return `<tr><td>${seq}</td><td class="txtL"><a href="#" onclick="javascript:getDetailView('${seq}');return false;">${title}</a></td><td>${department}</td><td class="num">${date}</td><td>${seq}</td></tr>`;
}

function shPage(...rows) {
  return `<table><tbody>${rows.join("")}</tbody></table>`;
}

test("마이홈 데이터에서 서울 공고만 남기고 자치구를 붙인다", () => {
  const payload = {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
      body: {
        item: [
          { pblancId: "1", pblancNm: "2026년 청년 전세임대 수시모집", suplyInsttNm: "LH", suplyTyNm: "전세임대", rcritPblancDe: "20260819", brtcNm: "서울특별시", signguNm: "", beginDe: "20260820", endDe: "20261231", suplyHoCo: "120호", przwnerPresnatnDe: "20270131", fullAdres: "서울특별시", url: "https://example.com/1" },
          { pblancId: "2", pblancNm: "강남 행복주택 입주자 모집", suplyInsttNm: "LH", suplyTyNm: "행복주택", rcritPblancDe: "20260818", brtcNm: "서울특별시", signguNm: "강남구", beginDe: "20260821", endDe: "20260830", url: "https://example.com/2" },
          { pblancId: "3", pblancNm: "양천구 행복주택 입주자 모집", suplyInsttNm: "LH", brtcNm: "서울특별시", signguNm: "양천구" },
          { pblancId: "4", pblancNm: "부산 공고", suplyInsttNm: "LH", brtcNm: "부산광역시", signguNm: "해운대구" },
        ],
      },
    },
  };

  const notices = parseMyHomeNotices(payload);
  // 부산 공고만 제외한다. 서울이면 서초·강남·송파가 아니어도 수집한다.
  assert.deepEqual(notices.map((notice) => notice.id), ["MYHOME-1", "MYHOME-2", "MYHOME-3"]);

  // 자치구를 특정할 수 없는 공고는 서울 전체로 둔다.
  assert.equal(notices[0].region, "서울 전체 · 상세 공급지역 확인");
  assert.equal(notices[0].districts.length, 25);
  assert.equal(notices[0].supplyCount, "120호");
  assert.equal(notices[0].winnerAnnouncementDate, "2027-01-31");
  assert.equal(notices[0].address, "서울특별시");

  assert.equal(notices[1].region, "강남구");
  assert.equal(notices[1].applyEnd, "2026-08-30");
  assert.deepEqual(notices[2].districts, ["양천구"]);
});

test("SH HTML에서 모집공고만 뽑고 후속 공고는 제외한다", () => {
  const html = `
    <table><tbody>
      <tr><td>2</td><td class="txtL"><a href="#" onclick="javascript:getDetailView('200');return false;">서초 행복주택 입주자 모집 공고</a></td><td>공공주택공급부</td><td class="num">2026-08-19</td><td>10</td></tr>
      <tr><td>3</td><td class="txtL"><a href="#" onclick="javascript:getDetailView('300');return false;">서초 행복주택 입주자 모집 최종 경쟁률</a></td><td>공공주택공급부</td><td class="num">2026-08-19</td><td>11</td></tr>
      <tr><td>1</td><td class="txtL"><a href="#" onclick="javascript:getDetailView('100');return false;">양천구 청년주택 모집 공고</a></td><td>맞춤주택공급부</td><td class="num">2026-08-18</td><td>9</td></tr>
    </tbody></table>`;

  const notices = parseShNotices(html);
  // 경쟁률 게시글만 제외한다. 양천구 공고는 서울이므로 남는다.
  assert.deepEqual(notices.map((notice) => notice.id), ["SH-200", "SH-100"]);
  assert.equal(notices[0].agency, "SH");
  assert.equal(notices[0].region, "서초구");
  assert.match(notices[0].sourceUrl, /seq=200/);
  assert.equal(notices[1].region, "양천구");
});

test("입주대상자 발표가 붙은 정기모집은 모집공고로 채택하지 않는다", () => {
  // 실제 SH 게시판 제목. '모집'을 포함하지만 이미 끝난 공고의 결과 발표다.
  const html = shPage(
    shRow("401", "2026년 전세임대형 든든주택 정기모집(2026.4.29.) 입주대상자 발표(계약안내문 첨부)"),
    shRow("402", "2026년 신혼신생아 Ⅰ전세임대 입주자 정기모집(2026.4.1.) 입주대상자 발표(계약안내문 첨부)"),
    shRow("403", "2026년 1차 일반주택형 미리내집(신혼신생아매입임대주택Ⅱ) 입주자 모집공고(2026.08.14.)"),
  );

  const notices = parseShNotices(html);
  assert.deepEqual(notices.map((notice) => notice.id), ["SH-403"]);
});

test("서울 안이면 어느 구의 모집공고든 수집한다", () => {
  // 실제 SH 게시판 제목. 서초·강남·송파가 아닌 구를 언급한다는 이유로 버리면 안 된다.
  const html = shPage(
    shRow("501", "[청년형] 특화형 매입임대주택(금천구) 입주자 모집 공고(운영기관 : 한지붕 협동조합)"),
    shRow("502", "양천구 청년협동조합(수요자맞춤형) 추가 입주자 모집 공고"),
    shRow("503", "서초 행복주택 입주자 모집 공고"),
  );

  const notices = parseShNotices(html);
  assert.deepEqual(notices.map((notice) => notice.id), ["SH-501", "SH-502", "SH-503"]);
  assert.deepEqual(notices[0].districts, ["금천구"]);
  assert.deepEqual(notices[1].districts, ["양천구"]);
  assert.deepEqual(notices[2].districts, ["서초구"]);
});

test("자치구 약칭이 한 글자면 제목의 다른 낱말과 섞이지 않는다", () => {
  const html = shPage(
    // '모집 중'의 '중'을 중구로 읽으면 안 된다.
    shRow("601", "2026년 행복주택 예비입주자 모집 중 변경 안내"),
    // 실제로 중구를 가리키는 제목은 중구로 읽어야 한다.
    shRow("602", "중구 청년안심주택 입주자 모집공고"),
    // '구로'로 시작하는 구는 약칭을 잘못 만들어 놓치기 쉽다.
    shRow("603", "구로 행복주택 입주자 모집 공고"),
  );

  const notices = parseShNotices(html);
  assert.equal(notices.length, 3);
  assert.equal(notices[0].region, "서울 전체 · 상세 공급지역 확인");
  assert.deepEqual(notices[1].districts, ["중구"]);
  assert.deepEqual(notices[2].districts, ["구로구"]);
});

test("여러 페이지의 모집공고를 합치고 같은 공고는 한 번만 담는다", () => {
  const first = shPage(
    shRow("701", "2026년 1차 청년안심주택 입주자 모집공고"),
    shRow("702", "2025년 재개발임대주택 예비3차 당첨자 발표"),
  );
  const second = shPage(
    shRow("703", "[토지지원 사회주택] 어울리 에어스페이스 신림3호점 입주자 모집공고"),
    // 게시판 목록이 밀리면 같은 공고가 다음 페이지에 다시 나타난다.
    shRow("701", "2026년 1차 청년안심주택 입주자 모집공고"),
  );

  const notices = mergeShPages([first, second]);
  assert.deepEqual(notices.map((notice) => notice.id), ["SH-701", "SH-703"]);
});
