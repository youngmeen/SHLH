import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ensureInventory, runSync, type SyncTrigger } from "../../lib/sync.ts";
import { createSyncStore, readExportDump, readSyncSummary } from "../../lib/sync-store.ts";

/**
 * `[수집]` 버튼과 launchd가 함께 쓰는 엔드포인트(SPEC S6).
 *
 * POST  수집 → 저장 → 재고 보충 → 로컬 백업 한 부
 * GET   마지막 동기화 기록. 화면이 "마지막 성공 시각"과 "실패한 소스"를 여기서 읽는다
 *
 * 두 경로가 같은 함수를 부른다. 갈라지면 스케줄에서만 나는 버그가 생긴다.
 */

const NO_STORE = { "Cache-Control": "no-store" };

// 무료 티어는 백업이 없다(S4). 동기화가 성공할 때마다 한 부 남긴다.
const DEFAULT_BACKUP_PATH = "backups/jib-alim-export.json";

async function writeLocalBackup() {
  try {
    // 번들러가 경로를 정적으로 알 수 없다고 경고한다. 의도한 동작이다 — 저장소
    // 디렉터리 기준으로 파일을 남긴다. 실행은 로컬 Node이므로 문제가 없다.
    const target = resolve(/* turbopackIgnore: true */ process.cwd(), process.env.BACKUP_PATH ?? DEFAULT_BACKUP_PATH);
    await mkdir(dirname(target), { recursive: true });
    const dump = await readExportDump();
    await writeFile(target, JSON.stringify(dump, null, 2), "utf8");
    return { ok: true, path: target, message: "최신 내보내기를 로컬에 남겼습니다." };
  } catch (reason) {
    // 백업 실패가 수집 결과를 지우지는 않는다. 실패했다는 사실만 알린다.
    const message = reason instanceof Error ? reason.message : "백업 실패";
    return { ok: false, path: null, message };
  }
}

export async function GET() {
  try {
    const summary = await readSyncSummary();
    return Response.json(summary, { headers: NO_STORE });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "동기화 기록을 읽지 못했습니다.";
    return Response.json({ last: null, lastSuccessAt: null, neverRan: true, message }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  const trigger: SyncTrigger = new URL(request.url).searchParams.get("trigger") === "schedule" ? "schedule" : "manual";

  let store;
  try {
    store = createSyncStore();
  } catch (reason) {
    // DATABASE_URL이 없으면 수집해도 저장할 곳이 없다. 수집만 하고 버리는 대신
    // 무엇이 빠졌는지 분명히 말한다.
    const message = reason instanceof Error ? reason.message : "저장소에 연결하지 못했습니다.";
    return Response.json({ status: "failed", message }, { status: 503, headers: NO_STORE });
  }

  const result = await runSync({
    trigger,
    store,
    afterSave: async ({ notices }) => [
      await ensureInventory({ districts: notices.flatMap((notice) => notice.districts), store }),
    ],
  });

  const backup = result.status === "failed" ? null : await writeLocalBackup();
  const status = result.status === "failed" ? 502 : 200;
  return Response.json({ ...result, backup }, { status, headers: NO_STORE });
}
