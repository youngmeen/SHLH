import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedNoticeUrl, parseNoticeDetailHtml } from "../app/lib/notice-detail.ts";
import { GET } from "../app/api/notice-detail/route.ts";

test("공고 상세 HTML에서 신청에 필요한 핵심 구간을 추출한다", () => {
  const html = `
    <h3>공급정보</h3><p>서울지역본부 공급호수 120호</p>
    <h3>공급일정</h3><p>접수기간 2026.08.20 ~ 2026.08.22</p>
    <h3>임대조건</h3><p>임대보증금 100만원, 월임대료 지원금의 연 1.2%</p>
    <h3>신청자격</h3><p>무주택자인 만 19세 이상 39세 이하 청년</p>
    <h3>안내사항</h3><p>공급호수 초과 시 조기 종료</p>
    <p>최종 경쟁률 12.4 : 1</p>
  `;

  const detail = parseNoticeDetailHtml(html);
  assert.match(detail.supply, /120호/);
  assert.match(detail.schedule, /2026\.08\.20/);
  assert.match(detail.rentalTerms, /임대보증금 100만원/);
  assert.match(detail.eligibility, /19세 이상 39세 이하/);
  assert.equal(detail.competition.ratio, "12.4 : 1");
  assert.equal(detail.competition.status, "published");
});

test("공식 상세 페이지 호스트만 서버에서 읽는다", () => {
  assert.equal(isAllowedNoticeUrl("https://apply.lh.or.kr/lhapply/example"), true);
  assert.equal(isAllowedNoticeUrl("https://www.i-sh.co.kr/app/example"), true);
  assert.equal(isAllowedNoticeUrl("http://127.0.0.1/private"), false);
  assert.equal(isAllowedNoticeUrl("https://example.com/notice"), false);
});

test("상세 API는 허용되지 않은 주소를 요청 전에 거절한다", async () => {
  const response = await GET(new Request("http://localhost/api/notice-detail?sourceUrl=http%3A%2F%2F127.0.0.1%2Fprivate"));
  assert.equal(response.status, 400);
});
