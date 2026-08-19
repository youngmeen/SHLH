import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "집알림 | 서울 LH·SH 임대주택 공고 모니터",
    description: "마이홈 API와 SH 공식 게시판에서 서초·강남·송파 공공임대 모집공고를 확인하는 실데이터 MVP",
    openGraph: {
      title: "집알림 BETA",
      description: "서울 LH·SH 임대주택 공식 공고 모니터",
      images: [{ url: imageUrl, width: 1728, height: 909, alt: "집알림 공공임대 공고 대시보드" }],
    },
    twitter: { card: "summary_large_image", images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
