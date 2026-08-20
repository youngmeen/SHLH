import { readExportDump } from "../../lib/sync-store.ts";

/**
 * 내보내기(SPEC S4 · R47).
 *
 * Supabase 무료 티어는 **백업을 제공하지 않고 1주 방치하면 프로젝트가 일시정지**된다.
 * 제품 가치의 절반이 누적 기록(지원 이력·판정 근거)에 있으므로 내 데이터를 한 파일로
 * 받을 수 있어야 한다. 재고는 다시 받을 수 있어 넣지 않는다.
 *
 * 프로필이 들어 있는 파일이다. 외부로 전송하지 않고 브라우저에 직접 내려준다(R47).
 */
export async function GET() {
  try {
    const dump = await readExportDump();
    const day = dump.exportedAt.slice(0, 10);
    return new Response(JSON.stringify(dump, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="jib-alim-export-${day}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "내보내기에 실패했습니다.";
    return Response.json({ message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
