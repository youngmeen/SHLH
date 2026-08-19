export type District = "서초구" | "강남구" | "송파구";

export type PublicNotice = {
  id: string;
  agency: "LH" | "SH" | "기타";
  title: string;
  housingType: string;
  region: string;
  districts: District[];
  publishedAt: string;
  applyStart: string | null;
  applyEnd: string | null;
  status: string;
  department: string | null;
  sourceUrl: string;
  supplyCount: string | null;
  winnerAnnouncementDate: string | null;
  address: string | null;
};

export type SourceState = {
  id: "myhome" | "sh-board";
  label: string;
  ok: boolean;
  count: number;
  message: string;
  sourceUrl: string;
};

export type NoticeFeed = {
  notices: PublicNotice[];
  fetchedAt: string;
  sources: SourceState[];
};
