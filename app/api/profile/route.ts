import { eq } from "drizzle-orm";
import { getDb } from "../../../db/index.ts";
import { profile as profileTable } from "../../../db/schema.ts";
import { defaultProfile, parseProfile } from "../../lib/profile.ts";

const PROFILE_ID = 1;
// 프로필은 브라우저에만 있으면 동기화가 판정할 수 없다. 저장소에 두는 대신
// 응답을 캐시하지 않는다.
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const db = getDb();
    const [row] = await db.select().from(profileTable).where(eq(profileTable.id, PROFILE_ID)).limit(1);
    if (!row) return Response.json({ profile: defaultProfile, saved: false }, { headers: NO_STORE });

    return Response.json(
      { profile: parseProfile(row.data), saved: true, updatedAt: row.updatedAt },
      { headers: NO_STORE },
    );
  } catch (reason) {
    // 저장소가 없어도 화면은 떠야 한다. 기본 프로필로 물러난다.
    const message = reason instanceof Error ? reason.message : "프로필을 읽지 못했습니다.";
    return Response.json({ profile: defaultProfile, saved: false, message }, { headers: NO_STORE });
  }
}

export async function PUT(request: Request) {
  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return Response.json({ message: "본문을 읽지 못했습니다." }, { status: 400, headers: NO_STORE });
  }

  const next = parseProfile(incoming);
  try {
    const db = getDb();
    await db
      .insert(profileTable)
      .values({ id: PROFILE_ID, data: next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: profileTable.id,
        set: { data: next, updatedAt: new Date() },
      });

    return Response.json({ profile: next, saved: true }, { headers: NO_STORE });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "프로필을 저장하지 못했습니다.";
    return Response.json({ message }, { status: 500, headers: NO_STORE });
  }
}
