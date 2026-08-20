import assert from "node:assert/strict";
import test from "node:test";
import { extractMyHomeRecords, MYHOME_INFO_URL } from "../app/lib/notice-sources.ts";

/** 실제 응답 형태를 그대로 따른 픽스처. 필드 이름과 값 모양을 바꾸지 말 것. */
function payload(items) {
  return { response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE" }, body: { item: items, totalCount: String(items.length) } } };
}

const 행복주택행 = (houseSn, hsmpNm, adres, sumSuplyCo, rentGtn, mtRntchrg) => ({
  pblancId: "21050",
  houseSn,
  pblancNm: "구리,남양주시 행복주택 예비입주자모집(26.08.05공고)",
  suplyInsttNm: "LH",
  suplyTyNm: "행복주택",
  houseTyNm: "아파트",
  rcritPblancDe: "20260805",
  beginDe: "20260831",
  endDe: "20260902",
  przwnerPresnatnDe: "20261207",
  brtcNm: "서울특별시",
  signguNm: "강북구",
  hsmpNm,
  fullAdres: adres,
  pnu: "1130510400100650014",
  sumSuplyCo: sumSuplyCo,
  totHshldCo: "168",
  rentGtn,
  mtRntchrg,
  heatMthdNm: "지역난방",
  sttusNm: "일반공고",
  url: "https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=1",
  pcUrl: "https://www.myhome.go.kr/hws/portal/sch/selectRsdtRcritNtcDetailView.do?pblancId=21050",
});

test("한 공고의 주택 단위 행이 각각 살아남는다", () => {
  const { notices, units } = extractMyHomeRecords(
    payload([
      행복주택행("1", "구리수택", "서울특별시 강북구 체육관로74번길 67", "50", "37224000", "156000"),
      행복주택행("3", "남양주별내 A24BL", "서울특별시 강북구 순화궁로 458-58", "117", "22896000", "103000"),
      행복주택행("5", "남양주별내 A1-2", "서울특별시 강북구 덕송3로 30", "158", "27180000", "122000"),
    ]),
  );

  assert.equal(notices.length, 1, "공고는 하나로 묶여야 한다");
  assert.equal(units.length, 3, "주택 행 3개가 모두 남아야 한다");
  assert.deepEqual(
    units.map((u) => u.complexName),
    ["구리수택", "남양주별내 A24BL", "남양주별내 A1-2"],
  );
  assert.deepEqual(units.map((u) => u.sourceKey), ["21050:1", "21050:3", "21050:5"]);
  assert.equal(units[0].deposit, 37224000);
  assert.equal(units[0].monthlyRent, 156000);
  assert.equal(units[0].householdCount, 50);
  assert.equal(units[0].totalHousehold, 168);
  assert.equal(units[0].noticeSourceId, "21050");
  // 이 API에는 면적이 없다. 없는 값을 만들지 않는다(R44).
  assert.equal(units[0].exclusiveArea, null);
  assert.equal(units[0].valueSource, "official");
});

test("주택 정보가 없는 행은 주택을 만들지 않는다", () => {
  const { notices, units } = extractMyHomeRecords(
    payload([
      {
        pblancId: "19631",
        houseSn: "0",
        pblancNm: "2026년 청년 전세임대 1순위 입주자 수시모집",
        suplyInsttNm: "LH",
        suplyTyNm: "전세임대",
        houseTyNm: "아파트",
        rcritPblancDe: "20260224",
        beginDe: "20260224",
        endDe: "20261231",
        brtcNm: "서울특별시",
        suplyHoCo: "7,000호",
        sttusNm: "일반공고",
        url: "https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=2",
      },
    ]),
  );

  assert.equal(notices.length, 1);
  assert.equal(units.length, 0, "전세임대는 공고 시점에 공급주택이 없다");
  assert.equal(notices[0].supplyCount, "7,000호", "원문 표기를 보존한다");
  assert.equal(notices[0].applyEnd, "2026-12-31");
});

test("정정공고와 원 공고 참조를 읽는다", () => {
  const { notices } = extractMyHomeRecords(
    payload([
      {
        pblancId: "21099",
        pblancNm: "[정정] 서울번동3 행복주택 예비입주자 모집",
        suplyInsttNm: "LH",
        suplyTyNm: "행복주택",
        rcritPblancDe: "20260819",
        brtcNm: "서울특별시",
        sttusNm: "정정공고",
        beforePblancId: "21049",
        url: "https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=3",
      },
    ]),
  );

  assert.equal(notices[0].status, "정정공고");
  assert.equal(notices[0].beforeSourceId, "21049", "원 공고를 가리켜야 한다");
});

test("공식 호스트가 아닌 링크는 안내 페이지로 돌린다", () => {
  const { notices } = extractMyHomeRecords(
    payload([
      {
        pblancId: "99999",
        pblancNm: "링크 검증용 공고",
        suplyInsttNm: "LH",
        rcritPblancDe: "20260820",
        brtcNm: "서울특별시",
        url: "https://example.com/attacker",
        pcUrl: "http://www.myhome.go.kr/insecure",
      },
    ]),
  );

  // 외부 API가 준 링크를 그대로 렌더하면 안 된다(R46, SPEC G1). https가 아닌 것도 거른다.
  assert.equal(notices[0].sourceUrl, MYHOME_INFO_URL);
});

test("서울이 아닌 행은 걸러내고, 지역을 지정하면 그 지역만 남긴다", () => {
  const rows = [
    { ...행복주택행("1", "구리수택", "경기도 구리시 체육관로74번길 67", "50", "37224000", "156000"), brtcNm: "경기도", signguNm: "구리시" },
    행복주택행("2", "서울단지", "서울특별시 강북구 어딘가 1", "10", "1000", "100"),
  ];
  assert.equal(extractMyHomeRecords(payload(rows)).units.length, 1);
  assert.equal(extractMyHomeRecords(payload(rows), "경기도").units.length, 1);
  assert.equal(extractMyHomeRecords(payload(rows), "").units.length, 2, "지역을 비우면 전부 남는다");
});

test("API가 오류를 주면 던진다", () => {
  assert.throws(
    () => extractMyHomeRecords({ response: { header: { resultCode: "11", resultMsg: "NO_MANDATORY_REQUEST_PARAMETER_ERROR" } } }),
    /NO_MANDATORY_REQUEST_PARAMETER_ERROR/,
  );
});

import { classifyShRow, cleanBoardTitle, extractShRecords } from "../app/lib/notice-sources.ts";

/** 실제 SH 게시판 행 구조. onclick·셀 순서를 바꾸지 말 것. */
function shRow(seq, title, department = "매입주택공급부", date = "2026-08-20") {
  return `<tr><td>${seq}</td><td class="txtL"><a href="#" onclick="javascript:getDetailView('${seq}');return false;">${title}</a></td><td>${department}</td><td class="num">${date}</td><td>${seq}</td></tr>`;
}

test("게시판 뱃지를 제목에서 떼어낸다", () => {
  // 실측: `NEW [청년형] 특화형 매입임대주택(성북구) 입주자 모집 공고`
  assert.equal(cleanBoardTitle("NEW [청년형] 특화형 매입임대주택(성북구) 입주자 모집 공고"), "[청년형] 특화형 매입임대주택(성북구) 입주자 모집 공고");
  assert.equal(cleanBoardTitle("2026년 2차 청년안심주택(공공임대) 입주자 모집공고"), "2026년 2차 청년안심주택(공공임대) 입주자 모집공고");
});

test("후속공고를 버리지 않고 종류별로 보관한다", () => {
  const html = [
    shRow("308605", "NEW [청년형] 특화형 매입임대주택(성북구) 입주자 모집 공고"),
    shRow("308100", "제49차 장기전세주택 입주자 모집공고(2025.12.15.) 당첨자 및 예비입주자 발표"),
    shRow("308101", "제5차 장기전세주택2(2025.07.28.공고) 예비 3차 입주대상자 발표"),
    shRow("308102", "2026년 1차 청년 매입임대주택 최종 경쟁률"),
    shRow("308103", "제50차 장기전세주택 서류심사 대상자 발표 및 서류제출 안내"),
  ].join("");

  const { notices, followUps } = extractShRecords([html]);
  assert.equal(notices.length, 1, "모집공고만 공고로 남는다");
  assert.equal(notices[0].title, "[청년형] 특화형 매입임대주택(성북구) 입주자 모집 공고", "뱃지가 떨어져야 한다");
  assert.equal(followUps.length, 4, "후속공고 4건이 보관되어야 한다 — 경쟁률의 유일한 출처다");
  assert.deepEqual(followUps.map((f) => f.kind).sort(), ["결과발표", "기타", "당첨자", "입주대상자"]);
  for (const f of followUps) assert.match(f.sourceUrl, /^https:\/\/www\.i-sh\.co\.kr\//);
});

test("정정공고는 모집공고로 유지하고 상태에 표시한다", () => {
  // 실측: `[정정]2026년 지원주택 입주자 모집공고`가 모집공고 목록에 섞여 있었다.
  // 정정은 내용이 바뀐 모집공고이므로 버리면 공고 자체를 잃는다.
  const { notices, followUps } = extractShRecords([shRow("307900", "[정정]2026년 지원주택 입주자 모집공고(2026. 7. 24.)")]);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].status, "정정공고");
  assert.equal(followUps.length, 0);
});

test("모집인지 확신할 수 없는 행은 버리지 않고 보관한다", () => {
  // R3: 애매한 공고는 자동 제외하지 않는다.
  const { notices, followUps } = extractShRecords([shRow("307800", "청년안심주택 예비입주자 추가 접수 안내")]);
  assert.equal(notices.length, 0);
  assert.equal(followUps.length, 1);
  assert.equal(followUps[0].kind, "기타");
});

test("같은 행이 여러 페이지에 나와도 한 번만 남는다", () => {
  const page = shRow("308605", "청년 매입임대주택 입주자 모집 공고");
  const { notices } = extractShRecords([page, page, page]);
  assert.equal(notices.length, 1);
});

test("행 성격 판별 규칙", () => {
  assert.equal(classifyShRow("2026년 1차 매입임대 입주자 모집 공고").kind, "recruitment");
  assert.equal(classifyShRow("[정정] 매입임대 입주자 모집 공고").corrected, true);
  assert.equal(classifyShRow("당첨자 발표").kind, "follow-up");
  assert.equal(classifyShRow("공고 없는 안내문").kind, "unknown");
});
