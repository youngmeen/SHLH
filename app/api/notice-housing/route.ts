import { readDistrictInventory, readInventoryFetchedAt, readNoticeBySource, readNoticeUnits } from "../../lib/sync-store.ts";
import { linkInventoryUnits } from "../../lib/unit-link.ts";
import { SEOUL_DISTRICTS, type District } from "../../lib/notice-types.ts";

/**
 * 공고 하나의 공급주택과 그 자치구 재고.
 *
 * 화면은 목록을 `MYHOME-21050`·`SH-308799` 같은 id로 다루므로 그 id를 그대로 받는다.
 *
 * 세 가지를 **서로 다른 상태로** 돌려준다(R43).
 *  · `notice: null`      아직 저장되지 않았다 (수집을 한 번도 돌리지 않았거나 못 찾았다)
 *  · `units: []`         공고가 주택 정보를 주지 않는다 (전세임대는 공급주택이 없다 · R28)
 *  · `inventory.count 0` 그 자치구 재고를 아직 받지 않았다
 *
 * 잇지 못한 주택은 `미확보`로 남긴다. 비슷한 이름에 붙이지 않는다(R44).
 */

const NO_STORE = { "Cache-Control": "no-store" };

// 자치구를 특정하지 못한 공고는 25개 전체가 붙는다. 그걸 다 읽으면 5만 행이다.
const MAX_INVENTORY_DISTRICTS = 3;

function parseNoticeId(id: string) {
  const [prefix, ...rest] = id.split("-");
  const sourceId = rest.join("-");
  if (!sourceId) return null;
  if (prefix === "MYHOME") return { source: "myhome", sourceId };
  if (prefix === "SH") return { source: "sh-board", sourceId };
  return null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const parsed = parseNoticeId(id);
  if (!parsed) {
    return Response.json({ message: "공고 id 형식이 아닙니다." }, { status: 400, headers: NO_STORE });
  }

  try {
    const stored = await readNoticeBySource(parsed.source, parsed.sourceId);
    if (!stored) {
      return Response.json(
        {
          notice: null,
          units: [],
          inventory: [],
          message: "아직 저장되지 않은 공고입니다. [수집]을 실행하면 여기에 공급주택이 표시됩니다.",
        },
        { headers: NO_STORE },
      );
    }

    const units = await readNoticeUnits(stored.id);
    const districts = (stored.districts ?? []).filter((district): district is District =>
      SEOUL_DISTRICTS.includes(district as District),
    );

    // 자치구를 특정한 공고만 재고를 함께 읽는다. `서울 전체`는 건수만 알려준다.
    const readable = districts.length <= MAX_INVENTORY_DISTRICTS ? districts : [];
    const inventory = await Promise.all(
      (readable.length > 0 ? readable : districts.slice(0, MAX_INVENTORY_DISTRICTS)).map(async (district) => {
        const meta = await readInventoryFetchedAt(district);
        const rows = readable.length > 0 ? await readDistrictInventory(district) : [];
        return { district, count: meta.count, fetchedAt: meta.fetchedAt, units: rows };
      }),
    );

    const allInventoryUnits = inventory.flatMap((entry) => entry.units);
    const withLinks = units.map((unit) => {
      if (!unit.complexName) return { unit, link: { status: "unmatched", reason: "name-too-weak", units: [] } };
      const link = linkInventoryUnits(unit.complexName, allInventoryUnits);
      return {
        unit,
        link: {
          status: link.status,
          reason: link.reason,
          typeMatched: link.status === "matched" ? link.typeMatched : false,
          // 재고에서 확인된 전용면적·주소·PNU. 잇지 못했으면 빈 배열이다.
          units: link.units,
        },
      };
    });

    return Response.json(
      {
        notice: stored,
        units: withLinks,
        inventory: inventory.map((entry) => ({
          district: entry.district,
          count: entry.count,
          fetchedAt: entry.fetchedAt,
          // 목록 전체를 화면에 던지지 않는다. 조건 필터는 화면이 한다.
          units: entry.units.slice(0, 200),
        })),
        districtsOmitted: districts.length > MAX_INVENTORY_DISTRICTS ? districts.length : 0,
      },
      { headers: NO_STORE },
    );
  } catch (reason) {
    // 저장소에 못 붙은 것과 "주택이 없음"을 구분한다(R43).
    const message = reason instanceof Error ? reason.message : "공급주택을 읽지 못했습니다.";
    return Response.json({ notice: null, units: [], inventory: [], message }, { status: 500, headers: NO_STORE });
  }
}
