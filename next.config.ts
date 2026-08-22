import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs는 자체 워커 파일을 런타임에 찾는다 — 번들에 말려들면 경로가 깨진다.
  serverExternalPackages: ["pdfjs-dist"],
  /* config options here */
};

export default nextConfig;
