import assert from "node:assert/strict";
import test from "node:test";

import { extractShAttachments, pickNoticePdf } from "../app/lib/sh-attachments.ts";
import { extractHousingRows } from "../app/lib/pdf-units.ts";
import { mapSearchUrl } from "../app/lib/format.ts";

// ─── SH 게시판 첨부파일: Innorix downList에서 다운로드 주소를 만든다 ─────────────

const 게시판HTML = `
<script>
  initParam.downList = [{"brdId":"GS0401","seq":"308799","fileSeq":"1","fileSize":"569492","oriFileNm":"2026년 하반기 금천구 청년 맞춤형주택 입주자 모집 공고.pdf","fileTp":"A"},{"brdId":"GS0401","seq":"308799","fileSeq":"2","fileSize":"842201","oriFileNm":"제출서류.hwpx","fileTp":"A"}];
  initInnorix();
</script>`;

test("게시판 HTML의 downList에서 첨부 목록과 다운로드 주소를 만든다", () => {
  const attachments = extractShAttachments(게시판HTML);
  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].name, "2026년 하반기 금천구 청년 맞춤형주택 입주자 모집 공고.pdf");
  assert.equal(attachments[0].size, 569492);
  assert.ok(attachments[0].downloadUrl.startsWith("https://www.i-sh.co.kr/app/com/file/innoFD.do?"));
  assert.ok(attachments[0].downloadUrl.includes("seq=308799"));
  assert.ok(attachments[0].downloadUrl.includes("fileSeq=1"));
});

test("공고문 PDF를 고른다 — hwpx는 고르지 않고, '공고' 이름을 우선한다", () => {
  const attachments = extractShAttachments(게시판HTML);
  const picked = pickNoticePdf(attachments);
  assert.ok(picked);
  assert.ok(picked.name.endsWith(".pdf"));
  assert.ok(picked.name.includes("공고"));
});

test("downList가 없거나 깨졌으면 빈 목록이다", () => {
  assert.deepEqual(extractShAttachments("<html>없음</html>"), []);
  assert.deepEqual(extractShAttachments("initParam.downList = [깨진값];"), []);
  assert.equal(pickNoticePdf([]), null);
});

// ─── PDF 줄에서 공급주택(단지명·주소·면적)을 뽑는다 ──────────────────────────────
// 픽스처는 실제 SH 공고문 2건에서 추출한 줄을 그대로 따랐다.

test("금천구 공고문 형태: 주택명 | 소재지 | 면적이 같은 줄과 다음 줄에 걸쳐 있다", () => {
  const rows = extractHousingRows([
    "주택명 | 소재지 | 총세대 | 전용면적(㎡) | 비 | 고",
    "G밸리하우스 | 시흥대로145길 67 | - 거주공간 : 2~5층",
    "29.87~31.05",
    "16세대",
    "근로자동 | (가산동 150-15) | (9.03평~9.39평)",
    "G밸리하우스 | 시흥대로145길 71 | 29.87~31.05",
    "기업인동 | (가산동 150-7) | (9.03평~9.39평)",
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "G밸리하우스");
  assert.equal(rows[0].address, "시흥대로145길 67");
  assert.equal(rows[0].area, "29.87~31.05");
  assert.equal(rows[1].address, "시흥대로145길 71");
  assert.equal(rows[1].area, "29.87~31.05"); // 같은 줄의 면적
});

test("미리내집 위치 안내 형태: 자치구 단지명 자치구 도로명주소", () => {
  const rows = extractHousingRows([
    "자치구 | 단지명 | 소재지주소",
    "강서구 | 마곡엠밸리10단지 | 강서구 마곡중앙1로 72",
    "광진구 | 래미안프리미어팰리스 | 광진구 아차산로 34",
    "송파구 | 잠실래미안아이파크 | 송파구 올림픽로 393",
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, "마곡엠밸리10단지");
  assert.equal(rows[0].address, "강서구 마곡중앙1로 72");
  assert.equal(rows[2].name, "잠실래미안아이파크");
});

test("도로명+번호가 없는 줄(예시 표·전화번호)은 뽑지 않는다", () => {
  const rows = extractHousingRows([
    "2014. 7. 25. | 2014. 7. 23. | 서울시 강서구 B오피스텔",
    "계약관련 문의 : 02-2627-2588",
    "접수기간 : 2026. 8. 19.(수) ~ 2026. 9. 17.(목) 18:00",
  ]);
  assert.deepEqual(rows, []);
});

test("같은 주소는 한 번만 뽑는다", () => {
  const rows = extractHousingRows([
    "G밸리하우스 | 시흥대로145길 67",
    "다시 등장 | 시흥대로145길 67",
  ]);
  assert.equal(rows.length, 1);
});

// ─── 지도 링크 ───────────────────────────────────────────────────────────────

test("주소로 카카오맵 검색 링크를 만들고, 서울·구가 없으면 힌트를 붙인다", () => {
  assert.equal(
    mapSearchUrl("시흥대로145길 67", "금천구"),
    `https://map.kakao.com/link/search/${encodeURIComponent("서울 금천구 시흥대로145길 67")}`,
  );
  // 주소에 이미 구가 있으면 서울만 보강한다
  assert.equal(
    mapSearchUrl("강서구 마곡중앙1로 72", "강서구"),
    `https://map.kakao.com/link/search/${encodeURIComponent("서울 강서구 마곡중앙1로 72")}`,
  );
  // 완전한 주소는 그대로
  assert.equal(
    mapSearchUrl("서울특별시 금천구 독산로96길 27-6", null),
    `https://map.kakao.com/link/search/${encodeURIComponent("서울특별시 금천구 독산로96길 27-6")}`,
  );
});
