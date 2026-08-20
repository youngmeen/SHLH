import assert from "node:assert/strict";
import test from "node:test";
import { orderDetailTargets, parsePortalDetail, parsePortalList, portalDetailUrl } from "../app/lib/housing-portal.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처는 2026-08-20에 실제로 받은 응답 구조를 그대로 따른다.
// 열 구성은 thead가 알려준다 — 모집상태 열이 조건부로 렌더되기 때문에 순서를
// 상수로 박으면 열이 하나 빠지는 날 조용히 어긋난다.
// ─────────────────────────────────────────────────────────────────────────────

const 목록_HEAD = `
  <thead>
    <tr>
      <th scope="col">번호</th>
      <th scope="col">청약유형</th>
      <th scope="col">공고명</th>
      <th scope="col">공고게시일</th>
      <th scope="col">발표일</th>
      <th scope="col">모집상태</th>
      <th scope="col">담당부서</th>
      <th scope="col">링크</th>
    </tr>
  </thead>`;

/** 실제 행은 JSP 조건문이 남긴 공백과 주석이 잔뜩 섞여 온다. 그 모양을 유지한다. */
function 목록행({ no, portalSeq, type, title, published, announce, status, department, shSeq }) {
  return `
    <tr>
      <td class="td1">${no}</td>
      <td class="td3">${type}</td> <!-- 2021-01-25 클래스 수정 -->
      <td class="txl td-m">
        <!--	<a href="/site/main/sh/publicLease/view?seq=${portalSeq}&cp=1&amp;supplyType=publicLease"></a>-->
        ${title}
      </td>
      <td class="td4"> <!-- 2021-01-25 클래스 수정 -->
            ${published}
      </td>
      <td class="td-mdisn">
            ${announce}
      </td>
      <td class="td-mdisn">${status}</td>
      <td class="td-mdisn">${department}</td> <!-- 2021-01-25 클래스 수정 -->
      <td class="td5"><a href="https://www.i-sh.co.kr/main/lay2/program/S1T294C295/www/brd/m_241/view.do?seq=${shSeq}" class="btn-gray" title="새창 이동" target="_blank">바로가기</a></td>
    </tr>`;
}

const 목록_HTML = `<table><caption>SH공사 번호, 청약유형, 공고명, 담당부서, 공고게시일, 발표일 정보 제공</caption>${목록_HEAD}<tbody>
  ${목록행({ no: 80, portalSeq: 1, type: "수요자맞춤형", title: "금천구 1인가구 청년 맞춤형주택(수요자맞춤형) 추가 입주자 모집 공고", published: "2026-08-19", announce: "-", status: "모집중", department: "매입주택공급부", shSeq: "308799" })}
  ${목록행({ no: 79, portalSeq: 2, type: "도시형생활주택", title: "2026년 1차 일반주택형 미리내집(신혼신생아매입임대주택Ⅱ) 입주자 모집공고(2026.08.14.)", published: "2026-08-14", announce: "2027-01-07", status: "모집중", department: "매입주택공급부", shSeq: "308644" })}
  ${목록행({ no: 76, portalSeq: 5, type: "재개발임대주택", title: "2026년 재개발임대주택 입주자 모집 일정 연기 안내", published: "2026-08-10", announce: "-", status: "", department: "주택공급기준부", shSeq: "308394" })}
</tbody></table>`;

test("목록에서 SH 게시판 seq를 조인 키로 읽는다", () => {
  const rows = parsePortalList(목록_HTML);

  assert.equal(rows.length, 3);
  // 게시판 수집이 만든 공고와 붙일 유일한 키다. 실측에서 SH 게시판 seq와 같았다.
  assert.deepEqual(rows.map((row) => row.shSeq), ["308799", "308644", "308394"]);
  assert.deepEqual(rows.map((row) => row.portalSeq), ["1", "2", "5"]);
});

test("목록에서 발표일·모집상태·청약유형을 읽는다", () => {
  const [금천, 미리내집] = parsePortalList(목록_HTML);

  assert.equal(금천.noticeType, "수요자맞춤형");
  assert.equal(금천.publishedAt, "2026-08-19");
  assert.equal(금천.status, "모집중");
  assert.equal(금천.department, "매입주택공급부");
  assert.match(금천.title, /^금천구 1인가구/);

  assert.equal(미리내집.announceAt, "2027-01-07");
  assert.equal(미리내집.noticeType, "도시형생활주택");
});

test("발표일 '-'와 빈 모집상태는 null로 둔다", () => {
  const [금천, , 연기안내] = parsePortalList(목록_HTML);

  // 미발표와 조회 실패를 같은 값으로 만들지 않는다(R43). 없는 값을 만들지도 않는다(R44).
  assert.equal(금천.announceAt, null, "'-'는 아직 발표되지 않았다는 뜻이다");
  assert.equal(연기안내.status, null, "빈 칸은 상태를 알 수 없다는 뜻이다");
});

test("열이 빠져도 헤더를 보고 맞춘다", () => {
  // 모집상태 열은 조건부로 렌더된다. 열이 빠진 날 담당부서를 상태로 읽으면 안 된다.
  const 상태없는_HTML = 목록_HTML
    .replace('<th scope="col">모집상태</th>', "")
    .replace(/<td class="td-mdisn">모집중<\/td>/g, "")
    .replace('<td class="td-mdisn"></td>', "");

  const rows = parsePortalList(상태없는_HTML);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].status, null);
  assert.equal(rows[0].department, "매입주택공급부", "열이 밀려 담당부서를 잃으면 안 된다");
});

// ─────────────────────────────────────────────────────────────────────────────
// 상세. SH 게시판에는 없는 접수기간·당첨자발표일·공급호수가 여기에 있다.
// 표기가 공고마다 다르다 — `접수기간 : A ~ B 18시`와 `접수일` + `○ 인터넷접수: A ~ B`
// 두 형태를 실제로 확인했다.
// ─────────────────────────────────────────────────────────────────────────────

function 상세_HTML(본문, { title, published, type, department }) {
  return `<div class="board-detail"><table><caption>국민임대</caption><tbody>
    <tr><th scope="row">제목</th><td colspan="3" class="tlt">${title}</td></tr>
    <tr><th scope="row">공고일</th><td>
        ${published}
      </td><th scope="row">유형</th><td>${type}</td></tr>
    <tr><th scope="row">담당부서</th><td>${department}</td><th scope="row">담당자 내선번호</th><td>1600-3456</td></tr>
    <tr><th scope="row" colspan="4">상세 정보</th></tr>
    <tr><td colspan="4">${본문}</td></tr>
  </tbody></table></div>`;
}

const 금천_상세 = 상세_HTML(
  `<p style="line-height: 200%;">■ 모집공고일 : 2026.08.19.(수)</p><br/>` +
    `<p style="line-height: 200%;">■ 공급호수 : G밸리하우스-5세대, 소셜믹스형 청년주택-7세대 (총12세대)</p><br/>` +
    `<p style="line-height: 200%;">■ 신청자격 : 첨부된 모집공고문 참조</p><br/>` +
    `<p style="line-height: 200%;">■ 접수기간 : 2026.08.19.(수) ~ 2026.09.17.(목) 18시</p>` +
    `<p style="line-height: 200%;">&nbsp;&nbsp;○ 등기우편 접수(일반우편 불가, 마감일 우체국 우편 접수분까지 인정)</p><br/>` +
    `<p style="line-height: 200%;">■ 당첨자발표 : 2026.12.11.(금) 금천구청 홈페이지 게시 및 당첨자 개별안내</p>`,
  { title: "금천구 1인가구 청년 맞춤형주택(수요자맞춤형) 추가 입주자 모집 공고", published: "2026-08-19", type: "수요자맞춤형", department: "매입주택공급부" },
);

const 미리내집_상세 = 상세_HTML(
  // 본문 앞머리에 안내문이 붙는다. 실측에서 이 문장이 `당첨자 발표`를 먼저 언급해
  // 날짜 없는 줄을 발표일로 집는 일이 있었다.
  `<p>★ 다른 주택들은 주택의 훼손을 방지하기 위해 당첨자 발표 전 공개하지 않으니(당첨자 발표 후 당첨자에 한 해 당첨된 주택공개), 전자 팸플릿을 참고하여 주시기 바랍니다.</p><p><br/></p><p>----------------------</p>` +
    `<p>■ 모집공고일: 2026.08.14.&nbsp;</p><br/><p>■ 공급호수 : 128.&nbsp;</p><br/>` +
    `<p>■ 신청자격: 모집공고문 참고&nbsp;</p><br/>` +
    `<p>■ 접수일</p><p>&nbsp;○ 인터넷접수: 2026.08.31. ~ 2026.09.02.&nbsp;</p><br/>` +
    `<p>■ 서류심사대상자 발표: 2026.09.07.&nbsp;</p><br/>` +
    `<p>■ 당첨자발표: 2027.01.07.&nbsp;</p>`,
  { title: "2026년 1차 일반주택형 미리내집(신혼신생아매입임대주택Ⅱ) 입주자 모집공고(2026.08.14.)", published: "2026-08-14", type: "도시형생활주택", department: "매입주택공급부" },
);

test("상세에서 접수기간과 당첨자발표일을 읽는다", () => {
  const detail = parsePortalDetail(금천_상세);

  assert.equal(detail.applyStart, "2026-08-19");
  assert.equal(detail.applyEnd, "2026-09-17");
  assert.equal(detail.announceAt, "2026-12-11", "발표일 뒤의 안내 문구는 날짜가 아니다");
  assert.equal(detail.publishedAt, "2026-08-19");
  assert.equal(detail.noticeType, "수요자맞춤형");
  assert.equal(detail.department, "매입주택공급부");
});

test("마감 시각이 적혀 있으면 KST 시각까지 남긴다", () => {
  const detail = parsePortalDetail(금천_상세);

  // "9/17 18시"까지 알면 마감 임박 알림(Phase 8)이 날짜만 볼 때보다 정확해진다.
  assert.equal(detail.applyDeadlineAt, "2026-09-17T18:00:00+09:00");
});

test("접수일 아래 인터넷접수 형태도 읽는다", () => {
  const detail = parsePortalDetail(미리내집_상세);

  assert.equal(detail.applyStart, "2026-08-31");
  assert.equal(detail.applyEnd, "2026-09-02");
  assert.equal(detail.announceAt, "2027-01-07", "서류심사 발표일을 당첨자 발표일로 읽으면 안 된다");
  assert.equal(detail.applyDeadlineAt, null, "시각이 없으면 만들지 않는다");
});

test("공급호수는 원문 그대로 남긴다", () => {
  // "G밸리하우스-5세대, 소셜믹스형 청년주택-7세대"를 12로 눌러버리면 어느 단지 몇 호인지
  // 잃는다. 숫자로 바꾸는 것은 세대수를 만드는 일에 가깝다(R44).
  assert.equal(parsePortalDetail(금천_상세).supplyCount, "G밸리하우스-5세대, 소셜믹스형 청년주택-7세대 (총12세대)");
  assert.equal(parsePortalDetail(미리내집_상세).supplyCount, "128");
});

test("본문에 없는 항목은 null로 둔다", () => {
  const 빈_상세 = 상세_HTML("<p>자세한 사항은 첨부된 공고문을 확인하여 주시기 바랍니다.</p>", {
    title: "2026년 재개발임대주택 입주자 모집 일정 연기 안내",
    published: "2026-08-10",
    type: "재개발임대주택",
    department: "주택공급기준부",
  });

  const detail = parsePortalDetail(빈_상세);
  assert.equal(detail.applyStart, null);
  assert.equal(detail.applyEnd, null);
  assert.equal(detail.announceAt, null);
  assert.equal(detail.supplyCount, null);
  assert.equal(detail.title, "2026년 재개발임대주택 입주자 모집 일정 연기 안내");
});

test("상세 URL은 서울주거포털만 가리킨다", () => {
  assert.equal(
    portalDetailUrl("2", 1),
    "https://housing.seoul.go.kr/site/main/sh/publicLease/view?seq=2&cp=1&supplyType=publicLease",
  );
});

// 실측(양천구 청년협동조합 공고): 마감일에 연도를 적지 않는 표기가 있다.
const 양천_상세 = 상세_HTML(
  `<p>■ 모집공고일 : 2026.08.14.(금)</p><br/><p>■ 공급호수 : 총 19세대</p><br/>` +
    `<p>■ 신청자격 : 첨부된 모집공고문 참조</p><br/>` +
    `<p>■ 접수기간 : 2026.08.18.(화) ~ 08.28.(금) 18:00</p>` +
    `<p>○ 이메일 접수 : ekgp0520@yangcheon.go.kr</p><br/>` +
    `<p>■ 당첨자발표 : 2026.11.25.(수) 예정</p>`,
  { title: "양천구 청년협동조합(수요자맞춤형) 추가 입주자 모집 공고", published: "2026-08-14", type: "수요자맞춤형", department: "매입주택공급부" },
);

test("마감일에 연도가 없으면 시작 연도를 붙인다", () => {
  const detail = parsePortalDetail(양천_상세);

  assert.equal(detail.applyStart, "2026-08-18");
  assert.equal(detail.applyEnd, "2026-08-28", "연도를 안 적었다고 접수기간을 버리면 안 된다");
  assert.equal(detail.applyDeadlineAt, "2026-08-28T18:00:00+09:00");
  assert.equal(detail.announceAt, "2026-11-25");
});

test("연말에 걸친 접수기간은 다음 해로 넘긴다", () => {
  const 연말_상세 = 상세_HTML(`<p>■ 접수기간 : 2026.12.20.(일) ~ 01.05.(화) 17:00</p>`, {
    title: "연말 접수 공고",
    published: "2026-12-19",
    type: "매입임대주택",
    department: "매입주택공급부",
  });

  const detail = parsePortalDetail(연말_상세);
  assert.equal(detail.applyStart, "2026-12-20");
  assert.equal(detail.applyEnd, "2027-01-05");
});

test("마감일이 아예 없으면 접수기간을 만들지 않는다", () => {
  const 시작만_상세 = 상세_HTML(`<p>■ 접수기간 : 2026.08.18.(화)부터 선착순</p>`, {
    title: "선착순 공고",
    published: "2026-08-18",
    type: "매입임대주택",
    department: "매입주택공급부",
  });

  const detail = parsePortalDetail(시작만_상세);
  // 시작만 알고 마감을 모르면 마감을 만들지 않는다(R44). 원문을 봐야 한다.
  assert.equal(detail.applyEnd, null);
  assert.equal(detail.applyDeadlineAt, null);
});

// 상세는 행마다 요청을 하나 더 쓴다. 상한에 걸리면 무엇을 먼저 읽을지가 결과를 가른다.
// 실측에서 붙은 14건 중 12건만 읽어 `모집마감` 공고가 먼저 소비된 일이 있었다.
test("상세는 모집중인 공고를 먼저 읽는다", () => {
  const rows = [
    { shSeq: "1", portalSeq: "1", status: "모집마감", publishedAt: "2026-08-19", title: "마감된 공고" },
    { shSeq: "2", portalSeq: "2", status: "모집중", publishedAt: "2026-06-01", title: "오래된 모집중 공고" },
    { shSeq: "3", portalSeq: "3", status: null, publishedAt: "2026-08-20", title: "상태 미확인" },
    { shSeq: "4", portalSeq: "4", status: "모집중", publishedAt: "2026-08-18", title: "최근 모집중 공고" },
  ];

  assert.deepEqual(orderDetailTargets(rows).map((row) => row.shSeq), ["4", "2", "3", "1"]);
});

test("상세를 따라갈 수 없는 행은 후보에서 뺀다", () => {
  const rows = [
    { shSeq: "1", portalSeq: null, status: "모집중", publishedAt: "2026-08-19", title: "행 번호를 모른다" },
    { shSeq: null, portalSeq: "2", status: "모집중", publishedAt: "2026-08-19", title: "붙일 게시판 공고가 없다" },
    { shSeq: "3", portalSeq: "3", status: "모집중", publishedAt: "2026-08-19", title: "정상" },
  ];

  assert.deepEqual(orderDetailTargets(rows).map((row) => row.shSeq), ["3"]);
});

// 실측(1~2인가구 도시형생활주택 잔여세대): `■ 접수일` 아래 순위별 `- …` 줄에 날짜가 있다.
// 항목 줄만 보면 접수기간이 통째로 비고, 실제로 모집중 공고가 그렇게 비어 있었다.
const 순위별_상세 = 상세_HTML(
  `<p>■ 신청자격: 입주자모집공고일(26. 8. 5.) 현재 서울특별시의 주민등록표에 등재된 1인가구 또는 2인가구 무주택세대구성원</p>` +
    `<p> ○ 단지 및 공급기준에 따라 추가 자격이 있으므로 자세한 내용은 공고문을 반드시 참고 </p><br/>` +
    `<p>■ 접수일</p><p> ○ 인터넷접수</p>` +
    `<p><span>   - 일반공급 1순위(소득 50%이하), 우선공급 1,2순위(소득 70%이하): 2026. 8. 18.(화) 10:00 ~ 2026. 8. 19.(수) 17:00</span></p>` +
    `<p><span>   - 일반공급 2순위(소득 70%이하), 주거약자 2순위(소득 70%이하) : 2026. 8. 20.(목) 10:00 ~ 17:00</span></p>` +
    `<p><span>   ※ 일반공급 1순위가 공급세대의 8배수를 초과할 경우 2순위는 신청접수 받지 않습니다. </span></p>` +
    `<p> ○ 우편접수 </p>` +
    `<p>   - 우편접수 기간: 2026. 8. 13.(목) ~ 2026. 8. 14.(금) [8. 14.(금) 소인분, 8. 18.(화) 도착분까지 유효]</p>` +
    `<p>■ 서류심사대상자 발표: 2026. 8. 31.(월)</p>` +
    `<p>■ 심사대상자 서류제출기간:  2026. 9. 2.(수) ~ 2026. 9. 4.(금)</p>` +
    `<p>■ 당첨자발표: 2026. 11. 20.(금)</p>`,
  { title: "2026년 1~2인가구를 위한 도시형생활주택(건설형원룸) 잔여세대 입주자 모집공고", published: "2026-08-05", type: "도시형생활주택", department: "맞춤주택공급부" },
);

test("순위·접수방법별로 나뉜 접수기간을 하나로 모은다", () => {
  const detail = parsePortalDetail(순위별_상세);

  // 우편 8.13 ~ 2순위 8.20. 어느 순위로 신청하든 이 창 안이다.
  assert.equal(detail.applyStart, "2026-08-13");
  assert.equal(detail.applyEnd, "2026-08-20");
  assert.equal(detail.applyDeadlineAt, "2026-08-20T17:00:00+09:00", "마지막 접수일의 마감 시각");
});

test("서류제출기간·서류심사 발표를 접수기간으로 읽지 않는다", () => {
  const detail = parsePortalDetail(순위별_상세);

  assert.notEqual(detail.applyEnd, "2026-09-04", "서류제출기간이 접수기간이 되면 안 된다");
  assert.equal(detail.announceAt, "2026-11-20", "서류심사 발표일이 아니라 당첨자 발표일이다");
});

test("대괄호 안의 소인·도착 날짜는 접수기간을 늘리지 않는다", () => {
  const 우편만_상세 = 상세_HTML(
    `<p>■ 접수일</p><p> ○ 우편접수 </p>` +
      `<p>   - 우편접수 기간: 2026. 8. 13.(목) ~ 2026. 8. 14.(금) [8. 14.(금) 소인분, 8. 18.(화) 도착분까지 유효]</p>`,
    { title: "우편접수 공고", published: "2026-08-05", type: "매입임대주택", department: "맞춤주택공급부" },
  );

  assert.equal(parsePortalDetail(우편만_상세).applyEnd, "2026-08-14");
});
