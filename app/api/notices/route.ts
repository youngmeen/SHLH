import { collectNoticeFeed } from "../../lib/notice-sources";

export async function GET() {
  const feed = await collectNoticeFeed();
  const allFailed = feed.sources.every((source) => !source.ok);

  return Response.json(feed, {
    status: allFailed ? 502 : 200,
    headers: {
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
    },
  });
}
