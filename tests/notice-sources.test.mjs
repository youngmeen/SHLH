import assert from "node:assert/strict";
import test from "node:test";
import { parseMyHomeNotices, parseShNotices } from "../app/lib/notice-sources.ts";

test("filters MyHome data to target districts and Seoul-wide notices", () => {
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
  assert.equal(notices.length, 2);
  assert.deepEqual(notices[0].districts, ["서초구", "강남구", "송파구"]);
  assert.equal(notices[0].supplyCount, "120호");
  assert.equal(notices[0].winnerAnnouncementDate, "2027-01-31");
  assert.equal(notices[0].address, "서울특별시");
  assert.equal(notices[1].region, "강남구");
  assert.equal(notices[1].applyEnd, "2026-08-30");
});

test("extracts target and Seoul-wide recruitment posts from SH HTML", () => {
  const html = `
    <table><tbody>
      <tr><td>2</td><td class="txtL"><a href="#" onclick="javascript:getDetailView('200');return false;">서초 행복주택 입주자 모집 공고</a></td><td>공공주택공급부</td><td class="num">2026-08-19</td><td>10</td></tr>
      <tr><td>3</td><td class="txtL"><a href="#" onclick="javascript:getDetailView('300');return false;">서초 행복주택 입주자 모집 최종 경쟁률</a></td><td>공공주택공급부</td><td class="num">2026-08-19</td><td>11</td></tr>
      <tr><td>1</td><td class="txtL"><a href="#" onclick="javascript:getDetailView('100');return false;">양천구 청년주택 모집 공고</a></td><td>맞춤주택공급부</td><td class="num">2026-08-18</td><td>9</td></tr>
    </tbody></table>`;

  const notices = parseShNotices(html);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].agency, "SH");
  assert.equal(notices[0].region, "서초구");
  assert.match(notices[0].sourceUrl, /seq=200/);
});
