"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SEOUL_DISTRICTS, shortDistrictName, type District, type NoticeFeed } from "./lib/notice-types";
import { initialNoticeFeed } from "./lib/initial-notice-feed";
import { evaluateAudience, type AudienceStatus, type MaritalStatus } from "./lib/audience-match";
import { ageOnDate, evaluateEligibility, type EligibilityStatus } from "./lib/eligibility";
import { formatArea, formatManwon, mapSearchUrl, sqmToPyeong, summarizeInventory } from "./lib/format";
import type { PdfHousingRow } from "./lib/pdf-units";
import { defaultProfile, parseProfile, type Profile, type Residence, type Welfare } from "./lib/profile";
import type { NoticeDetail } from "./lib/notice-detail";

type AgencyFilter = "all" | "LH" | "SH";
type ConditionView = "matched" | "all";
type SaveState = "idle" | "saving" | "saved" | "error";

// 동기화 기록과 공급주택은 저장된 값이다. 화면은 읽어서 보여주기만 한다.
type SyncSourceState = { id: string; label: string; ok: boolean; skipped: boolean; count: number; message: string };
type SyncRunState = {
  status: "running" | "ok" | "partial" | "failed";
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  sources: SyncSourceState[] | null;
  error: string | null;
};
type SyncSummary = { last: SyncRunState | null; lastSuccessAt: string | null; neverRan: boolean; message?: string };

type InventoryUnit = {
  complexName: string | null;
  address: string | null;
  pnu: string | null;
  unitNo: string | null;
  exclusiveArea: string | null;
  deposit: number | null;
  monthlyRent: number | null;
  supplyType: string | null;
};
type NoticeHousing = {
  notice: { id: number; supplyCount: string | null; applyEnd: string | null; announceAt: string | null } | null;
  units: { unit: InventoryUnit & { sigungu: string | null }; link: { status: string; reason: string | null; typeMatched?: boolean; units: InventoryUnit[] } }[];
  inventory: { district: string; count: number; fetchedAt: string | null; units: InventoryUnit[] }[];
  districtsOmitted?: number;
  message?: string;
};

const maritalLabels: Record<MaritalStatus, string> = {
  single: "미혼",
  married: "기혼",
  prospective: "예비부부",
};

// 판정 상태 하나가 화면 네 곳에서 다른 문구·기호·클래스로 쓰인다.
// 문구 차이(우선목록은 review/mismatch를 합치고, 상세는 나눈다)는 의도된 것이므로
// 한 표에 모아 눈에 보이게 둔다.
const fitPresentation: Record<AudienceStatus, { shortlist: string; verdict: string; tone: string; mark: string }> = {
  likely: { shortlist: "지원 검토 추천", verdict: "지원 검토 추천", tone: "pass", mark: "✓" },
  review: { shortlist: "자격 추가 확인", verdict: "자격 확인 후 검토", tone: "manual", mark: "!" },
  mismatch: { shortlist: "자격 추가 확인", verdict: "현재 조건으로 비추천", tone: "fail", mark: "×" },
};

// 자격 판정(Phase 3) 항목 상태의 화면 표기. 기존 checks 구역의 클래스를 그대로 쓴다.
const eligibilityPresentation: Record<EligibilityStatus, { tone: string; mark: string; word: string }> = {
  met: { tone: "pass", mark: "✓", word: "충족" },
  review: { tone: "manual", mark: "!", word: "확인 필요" },
  unmet: { tone: "fail", mark: "×", word: "미충족" },
};
const verdictTone: Record<string, string> = { eligible: "pass", review: "manual", ineligible: "fail" };

// 판정 상태별 묶음 제목. fitPresentation과 달리 목록 묶음용 문구다.
const groupTitles: Record<AudienceStatus, string> = {
  likely: "우선 확인할 공고",
  review: "판정 불가",
  mismatch: "조건 불일치",
};

const groupNotes: Record<AudienceStatus, string> = {
  likely: "입력한 조건과 관련 있는 공고입니다. 세부 자격은 원문에서 확인하세요.",
  review: "제목만으로는 대상 계층을 알 수 없습니다. 원문의 신청 자격을 직접 확인해야 합니다.",
  mismatch: "입력한 조건과 명백히 다른 대상입니다.",
};

// 동기화 상태 표기. `실패`와 `일부 실패`를 같은 말로 쓰면 R43 위반이다.
const syncStatusLabels: Record<string, string> = {
  running: "진행 중",
  ok: "정상",
  partial: "일부 실패",
  failed: "실패",
};

const agencyOptions = [
  { key: "all" as const, chip: "전체", glyph: "합", icon: "success", caption: "전체 공고" },
  { key: "LH" as const, chip: "LH", glyph: "LH", icon: "caution", caption: "마이홈·LH" },
  { key: "SH" as const, chip: "SH", glyph: "SH", icon: "muted", caption: "SH 공식" },
];

function formatDate(value: string | null) {
  if (!value) return "원문 확인";
  return value.replaceAll("-", ".");
}

// Intl 포매터 생성은 비싸고, formatFetchedAt은 렌더마다(=프로필 입력 한 글자마다) 불린다.
const fetchedAtFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatFetchedAt(value: string) {
  if (!value) return "수집 대기 중";
  return fetchedAtFormat.format(new Date(value));
}

function statusClass(status: string) {
  if (status === "접수중") return "eligible";
  if (status === "접수마감") return "unlikely";
  return "review";
}

export default function Home() {
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [feed, setFeed] = useState<NoticeFeed>(initialNoticeFeed);
  const [agencyFilter, setAgencyFilter] = useState<AgencyFilter>("all");
  const [conditionView, setConditionView] = useState<ConditionView>("matched");
  // ?notice=ID 로 특정 공고를 바로 연다 — 알림(Phase 8)이 이 링크를 쓴다.
  const [selectedId, setSelectedId] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("notice") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const [noticeDetail, setNoticeDetail] = useState<NoticeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // 저장된 프로필을 읽기 전에는 저장하지 않는다. 기본값으로 덮어쓰면 안 된다.
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [profileOpen, setProfileOpen] = useState(false);
  // 좁은 화면에서는 상세가 목록 아래로 밀려 보이지 않는다. 덮어서 띄운다.
  const [detailSheet, setDetailSheet] = useState(false);
  // Phase 2. 수집(저장)과 저장된 공급주택.
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [housing, setHousing] = useState<NoticeHousing | null>(null);
  const [housingLoading, setHousingLoading] = useState(false);
  // 공고문 PDF에서 뽑은 공급주택(S3). SH 게시판 공고에서만 시도한다.
  const [pdfUnits, setPdfUnits] = useState<{ attachment: string | null; rows: PdfHousingRow[]; message?: string } | null>(null);
  const [pdfUnitsLoading, setPdfUnitsLoading] = useState(false);

  // 저장소에 있는 것과 같은 값을 다시 쓰지 않기 위한 기준값.
  const savedSnapshot = useRef<string | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/profile", { headers: { Accept: "application/json" } });
      const data = await response.json() as { profile?: unknown };
      const loaded = parseProfile(data.profile);
      savedSnapshot.current = JSON.stringify(loaded);
      setProfile(loaded);
    } catch {
      savedSnapshot.current = JSON.stringify(defaultProfile);
      setProfile(defaultProfile);
    } finally {
      setProfileLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProfile(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

  // 입력이 멈추면 저장한다. 글자마다 저장하면 D1을 불필요하게 두드린다.
  useEffect(() => {
    if (!profileLoaded) return;
    const body = JSON.stringify(profile);
    // 불러온 직후에는 값이 같으므로 저장하지 않는다.
    if (body === savedSnapshot.current) return;

    const timer = window.setTimeout(() => {
      setSaveState("saving");
      void fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body })
        .then((response) => {
          if (response.ok) savedSnapshot.current = body;
          setSaveState(response.ok ? "saved" : "error");
        })
        .catch(() => setSaveState("error"));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [profile, profileLoaded]);

  // 캐시 무시는 사용자가 새로고침을 눌렀을 때만. 첫 로드까지 매번 무효화하면
  // 라우트의 s-maxage=900이 구조적으로 죽고 방문마다 상위 소스를 다시 읽는다.
  const loadNotices = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/notices${force ? `?refresh=${Date.now()}` : ""}`, { headers: { Accept: "application/json" } });
      const data = await response.json() as NoticeFeed;
      setFeed(data);
      if (!response.ok) throw new Error("공식 데이터 소스에 연결하지 못했습니다.");
      const failed = data.sources.filter((source) => !source.ok);
      if (failed.length > 0) setError(`${failed.map((source) => source.label).join(", ")} 수집이 지연되고 있습니다.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "공고를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNotices(), 0);
    return () => window.clearTimeout(timer);
  }, [loadNotices]);

  // 마지막 동기화 기록. "공고가 없다"와 "수집이 실패했다"를 화면이 구분해서 말하려면
  // 이 기록이 있어야 한다(R43).
  const loadSyncSummary = useCallback(async () => {
    try {
      const response = await fetch("/api/sync", { headers: { Accept: "application/json" } });
      setSyncSummary((await response.json()) as SyncSummary);
    } catch {
      setSyncSummary({ last: null, lastSuccessAt: null, neverRan: true, message: "동기화 기록을 읽지 못했습니다." });
    }
  }, []);

  // 렌더 중 setState를 피해 한 틱 미룬다. 목록 로딩(loadNotices)과 같은 방식이다.
  useEffect(() => {
    const timer = window.setTimeout(() => void loadSyncSummary(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSyncSummary]);

  // [수집]. launchd가 부르는 것과 같은 엔드포인트다(SPEC S6).
  const runSyncNow = useCallback(async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const response = await fetch("/api/sync", { method: "POST", headers: { Accept: "application/json" } });
      const data = (await response.json()) as { status?: string; saved?: { notices: number; units: number; followUps: number }; sources?: SyncSourceState[]; message?: string };
      if (!response.ok) throw new Error(data.message ?? "수집에 실패했습니다.");
      const failed = (data.sources ?? []).filter((source) => !source.ok && !source.skipped);
      setSyncMessage(
        `공고 ${data.saved?.notices ?? 0}건 · 주택 ${data.saved?.units ?? 0}건 · 후속공고 ${data.saved?.followUps ?? 0}건 저장` +
          (failed.length > 0 ? ` · 실패: ${failed.map((source) => source.label).join(", ")}` : ""),
      );
      await loadSyncSummary();
    } catch (reason) {
      setSyncMessage(reason instanceof Error ? reason.message : "수집에 실패했습니다.");
    } finally {
      setSyncing(false);
    }
  }, [loadSyncSummary]);

  const districtNotices = useMemo(
    () => feed.notices.filter((notice) => notice.districts.some((district) => profile.districts.includes(district))),
    [feed.notices, profile.districts],
  );
  const evaluatedNotices = useMemo(
    () => districtNotices.map((notice) => ({ notice, fit: evaluateAudience(profile, notice) })),
    [districtNotices, profile],
  );
  const conditionResults = conditionView === "matched"
    ? evaluatedNotices.filter(({ fit }) => fit.status !== "mismatch")
    : evaluatedNotices;
  const saveStateLabel = { idle: "", saving: "저장 중", saved: "저장됨", error: "저장 실패" }[saveState];

  const byAgency = (key: AgencyFilter) =>
    key === "all" ? conditionResults : conditionResults.filter(({ notice }) => notice.agency === key);
  const visibleResults = byAgency(agencyFilter);
  // 딥링크(?notice=ID)로 온 공고는 관심 지역·조건 필터에 걸러져 있어도 연다 —
  // 알림 링크가 필터 상태와 무관하게 동작해야 한다.
  const deepLinked = selectedId ? feed.notices.find((notice) => notice.id === selectedId) : undefined;
  const selectedResult =
    visibleResults.find(({ notice }) => notice.id === selectedId)
      ?? (deepLinked ? { notice: deepLinked, fit: evaluateAudience(profile, deepLinked) } : undefined)
      ?? visibleResults[0];
  const selected = selectedResult?.notice;
  // 판정 결과별로 묶어서 보여준다. 섞어놓으면 "제목으로 판정할 수 없는 공고"가
  // 조건에 맞는 공고처럼 읽힌다. 제목만으로 신청 가능을 확정하지 않는다는
  // 원칙에 따라 판정 불가를 따로 세운다.
  const groups = (["likely", "review", "mismatch"] as AudienceStatus[])
    .map((status) => ({ status, items: visibleResults.filter(({ fit }) => fit.status === status) }))
    .filter((group) => group.items.length > 0);

  // 주소 문자열에만 반응한다. 목록이 새로 들어와 같은 공고의 객체 참조만 바뀌는
  // 경우에 상세를 다시 읽지 않기 위한 것이다.
  const selectedSourceUrl = selected?.sourceUrl;
  const selectedNoticeId = selected?.id;

  useEffect(() => {
    if (!selectedSourceUrl) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setNoticeDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      void fetch(`/api/notice-detail?sourceUrl=${encodeURIComponent(selectedSourceUrl)}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = await response.json() as NoticeDetail & { message?: string };
          if (!response.ok) throw new Error(data.message || "공고 상세를 불러오지 못했습니다.");
          setNoticeDetail(data);
        })
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setDetailError(reason instanceof Error ? reason.message : "공고 상세를 불러오지 못했습니다.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetailLoading(false);
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedSourceUrl]);

  function updateNumber(key: "age" | "householdSize" | "monthlyIncome" | "totalAssets" | "children" | "carValue" | "subscriptionPaymentCount", value: string) {
    setProfile((current) => ({ ...current, [key]: Math.max(0, Number(value) || 0) }));
  }

  function updateField<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function toggleDistrict(district: District) {
    setProfile((current) => ({
      ...current,
      districts: current.districts.includes(district)
        ? current.districts.filter((item) => item !== district)
        : [...current.districts, district],
    }));
  }

  // 2단이 안 되는 폭에서는 상세를 덮어서 띄운다. 누른 결과가 항상 바로 보여야 한다.
  function selectNotice(id: string) {
    setSelectedId(id);
    if (!window.matchMedia("(min-width: 720px)").matches) setDetailSheet(true);
  }

  function simulateTelegram(title: string) {
    setSentNotice(title);
    window.setTimeout(() => setSentNotice(null), 3200);
  }

  function searchWithProfile() {
    setConditionView("matched");
    setProfileOpen(false);
  }

  // 저장된 공급주택. 수집을 돌리지 않았으면 비어 있고, 화면은 그렇게 말한다.
  useEffect(() => {
    if (!selectedNoticeId) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setHousing(null);
      setHousingLoading(true);
      void fetch(`/api/notice-housing?id=${encodeURIComponent(selectedNoticeId)}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      })
        .then(async (response) => setHousing((await response.json()) as NoticeHousing))
        .catch(() => {
          if (!controller.signal.aborted) setHousing({ notice: null, units: [], inventory: [], message: "공급주택을 읽지 못했습니다." });
        })
        .finally(() => {
          if (!controller.signal.aborted) setHousingLoading(false);
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedNoticeId]);

  // 공고문 PDF의 공급주택. 첫 요청은 PDF 파싱 때문에 수 초 걸리고, 이후는
  // 하루 캐시에서 온다. SH 게시판 주소가 아니면 시도하지 않는다.
  const selectedAgency = selected?.agency;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!selectedSourceUrl || selectedAgency !== "SH") {
        setPdfUnits(null);
        return;
      }
      setPdfUnits(null);
      setPdfUnitsLoading(true);
      void fetch(`/api/notice-pdf-units?sourceUrl=${encodeURIComponent(selectedSourceUrl)}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = await response.json() as { attachment: string | null; rows: PdfHousingRow[]; message?: string };
          setPdfUnits(response.ok ? data : { attachment: null, rows: [], message: data.message ?? "공고문 PDF를 읽지 못했습니다." });
        })
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setPdfUnits({ attachment: null, rows: [], message: "공고문 PDF를 읽지 못했습니다. 원문에서 확인하세요." });
        })
        .finally(() => {
          if (!controller.signal.aborted) setPdfUnitsLoading(false);
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedSourceUrl, selectedAgency]);

  // 생년월일이 있으면 오늘 기준 만 나이를 보여준다. 판정 표는 공고일 기준으로 따로 계산한다(R12).
  const todayAge = ageOnDate(profile.birthDate, new Date().toISOString().slice(0, 10)) ?? profile.age;
  const profileSummary = `만 ${todayAge}세 · ${profile.householdSize}인 · ${profile.monthlyIncome.toLocaleString()}만원`;
  // 자격 판정(Phase 3). 상세 텍스트가 아직 없으면 없는 대로 판정한다 — 그 항목은 확인 필요로 나온다(R14).
  const eligibility = selected
    ? evaluateEligibility(profile, { title: selected.title, publishedAt: selected.publishedAt }, noticeDetail?.eligibility ?? null)
    : null;
  const okSources = feed.sources.filter((source) => source.ok).length;

  return (
    <main className="appShell">
      <header className="appHeader">
        <a className="brand" href="#top" aria-label="집알림 처음으로"><span className="brandMark">집</span><span>집알림</span><small>BETA</small></a>
        <div className="headerStatus"><span className={`pulse ${error ? "warning" : ""}`} />{loading ? "공식 공고 확인 중" : `공식 공고 ${feed.notices.length}건 연결`}</div>
        <button className="profileButton" type="button" onClick={() => setProfileOpen(true)} aria-haspopup="dialog">
          <small>내 조건</small><strong>{profileSummary}</strong>
        </button>
        <button className="telegramButton" type="button" onClick={() => void loadNotices(true)} disabled={loading}>{loading ? "불러오는 중" : "공고 새로고침"}</button>
        <button className="telegramButton" type="button" onClick={() => void runSyncNow()} disabled={syncing} title="수집한 공고와 공급주택을 저장소에 저장합니다">{syncing ? "수집 중" : "수집"}</button>
      </header>

      <div className="demoBanner" role="note">
        <strong>실데이터 BETA</strong><span>마이홈 API와 SH 공식 게시판을 읽습니다. 신청 자격과 접수 가능 여부는 반드시 원문에서 최종 확인하세요.</span>
      </div>

      <div className="summaryBar" id="top">
        <div className="summaryCount">
          <p className="eyebrow">서울 공공임대 공고 모니터</p>
          <h1>내 조건으로 확인할 공고가 <em>{loading ? "···" : `${conditionResults.length}건`}</em></h1>
          <p className="summaryNote">‘조건 추천’은 명백히 다른 대상만 제외합니다. 제목으로 판정할 수 없는 공고는 <b>판정 불가</b>로 따로 묶어 보여줍니다.</p>
        </div>
        <div className="summaryFilters">
          <div className="filters" aria-label="조건 필터">
            <button type="button" className={conditionView === "matched" ? "active" : ""} onClick={() => setConditionView("matched")}>조건 추천</button>
            <button type="button" className={conditionView === "all" ? "active" : ""} onClick={() => setConditionView("all")}>전체 공고</button>
          </div>
          <div className="filters" aria-label="공급기관 필터">
            {agencyOptions.map((option) => <button type="button" key={option.key} className={agencyFilter === option.key ? "active" : ""} onClick={() => setAgencyFilter(option.key)}>{option.chip} {byAgency(option.key).length}</button>)}
          </div>
        </div>
        <div className="summaryMeta">
          <span>최근 공식 수집 {formatFetchedAt(feed.fetchedAt)}</span>
          <small>{okSources}/{feed.sources.length || 2}개 소스 정상 · 15분 캐시</small>
          <small>
            {syncSummary?.neverRan
              ? "저장 이력 없음 · [수집]을 누르면 저장을 시작합니다"
              : `마지막 저장 ${formatFetchedAt(syncSummary?.lastSuccessAt ?? "")} · ${syncStatusLabels[syncSummary?.last?.status ?? ""] ?? "상태 미확인"}`}
          </small>
          <small><a href="/api/export" download>내 데이터 내보내기(JSON)</a></small>
        </div>
      </div>

      {error && <p className="summaryError" role="status">{error}</p>}
      {syncMessage && <p className="summaryError" role="status">{syncMessage}</p>}
      {syncSummary?.last?.sources
        ?.filter((source) => !source.ok && !source.skipped)
        .map((source) => (
          <p className="summaryError" role="status" key={source.id}>
            {source.label} 저장 실패 · {source.message}
          </p>
        ))}

      <div className="browser">
        <section className="noticeColumn" aria-label="모집공고 목록" aria-busy={loading}>
          {loading && visibleResults.length === 0 && <div className="emptyState"><strong>공식 공고를 확인하고 있습니다.</strong><p>마이홈과 SH 소스를 순서대로 읽는 중입니다.</p></div>}

          {groups.map((group) => (
            <section className="noticeGroup" key={group.status} aria-labelledby={`group-${group.status}`}>
              <p className={`listDivider ${group.status}`} id={`group-${group.status}`}>
                {groupTitles[group.status]} <b>{group.items.length}</b>
                <small>{groupNotes[group.status]}</small>
              </p>
              {group.items.map(({ notice, fit }) => (
                <button
                  type="button"
                  key={notice.id}
                  className={`noticeCard ${selected?.id === notice.id ? "selected" : ""} ${fit.status === "mismatch" ? "mismatch" : ""}`}
                  onClick={() => selectNotice(notice.id)}
                  aria-current={selected?.id === notice.id}
                >
                  <div className="noticeMeta">
                    <span className={`agency ${notice.agency.toLowerCase()}`}>{notice.agency}</span>
                    <span className={`statusPill ${statusClass(notice.status)}`}>{notice.status}</span>
                  </div>
                  <h3>{notice.title}</h3>
                  <p>{notice.region} · {notice.housingType}</p>
                  {notice.address && <p>📍 {notice.address}</p>}
                  <div className="noticeFacts">
                    <span><small>게시일</small><strong>{formatDate(notice.publishedAt)}</strong></span>
                    <span><small>접수 마감</small><strong>{formatDate(notice.applyEnd)}</strong></span>
                    <span><small>공급 규모</small><strong>{notice.supplyCount ?? "원문 확인"}</strong></span>
                  </div>
                  <span className={`fitPill ${fit.status}`}>{fit.label}</span>
                </button>
              ))}
            </section>
          ))}

          {!loading && visibleResults.length === 0 && <div className="emptyState"><strong>현재 내 조건에 추천할 공고가 없습니다.</strong><p>‘전체 공고’에서 제외된 공고를 확인하거나 관심 지역·공급기관을 바꿔 주세요.</p><button type="button" onClick={() => setConditionView("all")}>전체 공고 보기</button></div>}
        </section>

        <aside className={`detailColumn ${detailSheet ? "asSheet" : ""}`} id="notice-detail">
          <button type="button" className="sheetClose" onClick={() => setDetailSheet(false)}>← 목록으로</button>
          {!selected && <div className="detailEmpty"><strong>공고를 선택하세요.</strong><p>왼쪽 목록에서 공고를 고르면 신청자격과 임대조건을 여기에 보여줍니다.</p></div>}
          {selected && (
            <section className="detailPanel" aria-live="polite">
              <div className="detailHeader"><div><p>공식 공고 상세 확인</p><h2>{selected.title}</h2></div><div className="detailActions"><a href={selected.sourceUrl} target="_blank" rel="noreferrer">공식 신청 페이지</a><button type="button" onClick={() => simulateTelegram(selected.title)}>텔레그램 알림 미리보기</button></div></div>
              <div className="decisionStrip">
                <div><small>추천 판단</small><strong>{fitPresentation[selectedResult.fit.status].verdict}</strong><p>{selectedResult.fit.detail}</p></div>
                <div><small>공급 규모</small><strong>{selected.supplyCount ?? "원문 확인"}</strong><p>{selected.address ?? selected.region}</p></div>
                <div><small>당첨자 발표</small><strong>{formatDate(selected.winnerAnnouncementDate)}</strong><p>일정은 공식 공고 변경 여부 확인 필요</p></div>
                <div><small>공식 경쟁률</small><strong>{detailLoading ? "확인 중" : noticeDetail?.competition.ratio ?? (selected.status === "접수중" ? "아직 집계 전" : "후속 공지 확인")}</strong><p>최종 경쟁률 공지가 있을 때만 표시</p></div>
              </div>

              <section className="officialBrief">
                <div className="officialBriefHeader"><div><p>NOTICE BRIEF</p><h3>공고문 핵심 내용</h3></div><span>공식 상세 페이지 자동 추출</span></div>
                {detailLoading && <div className="briefState">신청자격과 임대조건을 불러오고 있습니다.</div>}
                {detailError && <div className="briefState warning">상세 내용을 자동으로 읽지 못했습니다. 공식 신청 페이지에서 확인해 주세요.</div>}
                {!detailLoading && noticeDetail && (
                  <div className="briefGrid">
                    <article><small>신청자격</small><p>{noticeDetail.eligibility ?? "본문에서 구조화된 자격 내용을 찾지 못했습니다. 첨부 공고문을 확인해 주세요."}</p></article>
                    <article><small>임대조건</small><p>{noticeDetail.rentalTerms ?? "임대보증금과 월임대료는 첨부 공고문에서 확인해 주세요."}</p></article>
                    <article><small>신청일정</small><p>{noticeDetail.schedule ?? `접수 ${formatDate(selected.applyStart)} ~ ${formatDate(selected.applyEnd)}`}</p></article>
                    <article><small>제출서류·주의사항</small><p>{noticeDetail.documents ?? noticeDetail.caution ?? "제출서류와 유의사항은 공식 공고문 첨부파일에서 확인해 주세요."}</p></article>
                  </div>
                )}
              </section>

              <section className="officialBrief">
                <div className="officialBriefHeader"><div><p>SUPPLY UNITS</p><h3>공급주택과 자치구 재고</h3></div><span>저장된 공식 데이터</span></div>
                {housingLoading && <div className="briefState">저장된 공급주택을 불러오고 있습니다.</div>}
                {selected.agency === "SH" && pdfUnitsLoading && (
                  <div className="briefState">공고문 PDF에서 공급주택을 읽고 있습니다 (첫 조회는 몇 초 걸립니다).</div>
                )}
                {selected.agency === "SH" && !pdfUnitsLoading && pdfUnits?.message && (
                  <div className="briefState warning">{pdfUnits.message}</div>
                )}
                {selected.agency === "SH" && !pdfUnitsLoading && pdfUnits && pdfUnits.rows.length > 0 && (
                  <>
                    <div className="briefState">
                      공고문 PDF에서 자동 추출한 공급주택 {pdfUnits.rows.length}곳 — 「{pdfUnits.attachment}」 기준.
                      표를 기계로 읽은 결과이므로 지원 전 원문과 대조하세요.
                    </div>
                    <div className="briefGrid">
                      {pdfUnits.rows.map((row) => {
                        const districtHint = selected.districts[0] ?? null;
                        const range = row.area?.match(/^(\d+\.?\d*)~(\d+\.?\d*)$/);
                        const areaText = row.area
                          ? range
                            ? `전용 ${row.area}㎡ · 약 ${sqmToPyeong(Number(range[1]))}~${sqmToPyeong(Number(range[2]))}평`
                            : `전용 ${formatArea(row.area) ?? `${row.area}㎡`}`
                          : "면적은 원문 확인";
                        return (
                          <article key={row.address}>
                            <small>{row.name ?? "단지명은 원문 확인"}</small>
                            <p><b>📍 {row.address}</b> <a href={mapSearchUrl(row.address, districtHint)} target="_blank" rel="noreferrer">지도</a></p>
                            <p>{areaText}</p>
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}
                {!housingLoading && housing?.message && <div className="briefState warning">{housing.message}</div>}
                {!housingLoading && housing && !housing.message && housing.units.length === 0 && (
                  <div className="briefState">
                    공식 자료로 확인된 공급주택이 없습니다. 전세임대는 공고 시점에 공급주택이 정해지지 않습니다.
                  </div>
                )}
                {!housingLoading && housing && housing.units.length > 0 && (
                  <div className="briefGrid">
                    {housing.units.map(({ unit, link }, index) => (
                      <article key={`${unit.complexName ?? "unit"}-${index}`}>
                        <small>{unit.complexName ?? "단지명 미확보"}{unit.sigungu ? ` · ${unit.sigungu}` : ""}{unit.supplyType ? ` · ${unit.supplyType}` : ""}</small>
                        <p><b>📍 {unit.address ?? "주소 미확보"}</b>{unit.address && <> <a href={mapSearchUrl(unit.address, null)} target="_blank" rel="noreferrer">지도</a></>}</p>
                        <p>
                          {link.status === "matched"
                            ? `전용 ${link.units.map((row) => formatArea(row.exclusiveArea)).filter(Boolean).join(" / ")} (재고 대조${link.typeMatched ? " · 유형 일치" : ""})`
                            : "전용면적 미확보 — 재고에서 같은 단지를 찾지 못했습니다"}
                        </p>
                        <p>
                          {[
                            formatManwon(unit.deposit) && `보증금 ${formatManwon(unit.deposit)}`,
                            formatManwon(unit.monthlyRent) && `월임대료 ${formatManwon(unit.monthlyRent)}`,
                          ].filter(Boolean).join(" · ") || "임대조건은 원문 확인"}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
                {!housingLoading &&
                  housing?.inventory?.map((entry) => {
                    const sample = entry.units ?? [];
                    const complexes = summarizeInventory(sample);
                    return (
                      <div key={entry.district}>
                        <div className="briefState">
                          {entry.district} 매입임대 재고 {entry.count.toLocaleString()}건
                          {entry.fetchedAt ? ` · ${formatFetchedAt(entry.fetchedAt)} 기준` : " · 아직 받지 않았습니다"}
                          {" — 이 공고의 공급주택 목록이 아니라, 이 자치구에 있는 공공 매입임대 재고 참고 자료입니다. 실제 공급 위치·호수는 공고문에서 확인하세요."}
                        </div>
                        {complexes.length > 0 && (
                          <div className="briefGrid">
                            {complexes.slice(0, 8).map((complex) => (
                              <article key={`${entry.district}-${complex.name}`}>
                                <small>{complex.name} · 표본 {complex.count}호{complex.supplyTypes.length > 0 ? ` · ${complex.supplyTypes.join("·")}` : ""}</small>
                                <p><b>📍 {complex.address ?? "주소 미확보"}</b>{complex.address && <> <a href={mapSearchUrl(complex.address, null)} target="_blank" rel="noreferrer">지도</a></>}</p>
                                <p>
                                  {complex.minArea !== null && complex.maxArea !== null
                                    ? complex.minArea === complex.maxArea
                                      ? `전용 ${formatArea(String(complex.minArea))}`
                                      : `전용 ${complex.minArea}~${complex.maxArea}㎡ · 약 ${sqmToPyeong(complex.minArea)}~${sqmToPyeong(complex.maxArea)}평`
                                    : "면적 미기재"}
                                  {complex.minDeposit !== null ? ` · 보증금 ${formatManwon(complex.minDeposit)}${complex.maxDeposit !== complex.minDeposit ? ` ~ ${formatManwon(complex.maxDeposit)}` : ""}` : ""}
                                  {complex.minRent !== null ? ` · 월 ${formatManwon(complex.minRent)}${complex.maxRent !== complex.minRent ? ` ~ ${formatManwon(complex.maxRent)}` : ""}` : ""}
                                </p>
                              </article>
                            ))}
                          </div>
                        )}
                        {complexes.length > 8 && (
                          <div className="briefState">외 {complexes.length - 8}개 단지 — 표본 {sample.length}건 기준</div>
                        )}
                      </div>
                    );
                  })}
                {!housingLoading && (housing?.districtsOmitted ?? 0) > 0 && (
                  <div className="briefState">자치구를 특정하지 않은 공고입니다({housing?.districtsOmitted}개 구). 재고는 원문에서 공급지역을 확인한 뒤 대조하세요.</div>
                )}
              </section>

              <div className="detailGrid">
                <div className="checks">
                  {eligibility && (
                    <div className={verdictTone[eligibility.verdict]}>
                      <span>{eligibilityPresentation[eligibility.verdict === "eligible" ? "met" : eligibility.verdict === "ineligible" ? "unmet" : "review"].mark}</span>
                      <div>
                        <strong>{eligibility.audienceLabel} · {eligibility.verdictLabel}</strong>
                        <small>{detailLoading ? "원문 기준을 읽는 중 — 판정이 갱신될 수 있습니다" : noticeDetail?.eligibility ? "공식 상세의 신청자격 문구를 함께 판정했습니다" : "원문 기준을 읽지 못해 입력값 기준의 판정입니다"}</small>
                      </div>
                    </div>
                  )}
                  {eligibility?.items.map((entry) => (
                    <div className={eligibilityPresentation[entry.status].tone} key={entry.key}>
                      <span>{eligibilityPresentation[entry.status].mark}</span>
                      <div><strong>{entry.label} · {eligibilityPresentation[entry.status].word}</strong><small>{entry.basis}</small></div>
                    </div>
                  ))}
                </div>
                <aside className="telegramPreview">
                  <div className="telegramTop"><span className="telegramLogo">T</span><div><strong>집알림 봇</strong><small>알림 예시</small></div></div>
                  <div className="messageBubble"><span>새 공고</span><strong>{selected.region} · {selected.housingType}</strong><p>{selected.title}</p><dl><div><dt>공급기관</dt><dd>{selected.department ?? selected.agency}</dd></div><div><dt>마감</dt><dd>{formatDate(selected.applyEnd)}</dd></div></dl><a href={selected.sourceUrl} target="_blank" rel="noreferrer">공식 원문 열기</a></div>
                </aside>
              </div>
            </section>
          )}
        </aside>
      </div>

      <footer><div><span className="brandMark">집</span><strong>집알림 실데이터 MVP</strong></div><p>국토교통부 마이홈 API · SH 공식 공고</p><p>다음 단계: 자격 기준 구조화와 Telegram Bot 연결</p></footer>

      {profileOpen && (
        <div className="dialogBackdrop" onClick={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}>
          <div className="profileDialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
            <div className="panelTitle">
              <div><p>MY PROFILE</p><h2 id="profile-dialog-title">내 조건{saveStateLabel && <small className="saveState">{saveStateLabel}</small>}</h2></div>
              <button type="button" className="dialogClose" onClick={() => setProfileOpen(false)} aria-label="닫기">✕</button>
            </div>

            <div className="profileDialogBody">
              <fieldset className="fieldGroup districtGroup">
                <legend>관심 지역</legend>
                <div className="chipGrid">
                  {SEOUL_DISTRICTS.map((district) => (
                    <label className={profile.districts.includes(district) ? "checked" : ""} key={district}>
                      <input type="checkbox" checked={profile.districts.includes(district)} onChange={() => toggleDistrict(district)} />{shortDistrictName(district)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="inputGrid">
                <label><span>생년월일</span><div><input type="date" value={profile.birthDate} onChange={(event) => updateField("birthDate", event.target.value)} /><em>{profile.birthDate ? `만 ${todayAge}세` : `미입력 · ${profile.age}세로 판정`}</em></div></label>
                <label><span>가구원</span><div><input type="number" min="1" max="10" value={profile.householdSize} onChange={(event) => updateNumber("householdSize", event.target.value)} /><em>명</em></div></label>
                <label className="wide"><span>세대 월소득</span><div><input type="number" min="0" step="10" value={profile.monthlyIncome} onChange={(event) => updateNumber("monthlyIncome", event.target.value)} /><em>만원</em></div></label>
                <label className="wide"><span>총자산</span><div><input type="number" min="0" step="100" value={profile.totalAssets} onChange={(event) => updateNumber("totalAssets", event.target.value)} /><em>만원</em></div></label>
                <label className="wide"><span>자동차 가액</span><div><input type="number" min="0" step="100" value={profile.carValue} onChange={(event) => updateNumber("carValue", event.target.value)} /><em>만원 · 0=없음</em></div></label>
                <label><span>자녀 수</span><div><input type="number" min="0" max="10" value={profile.children} onChange={(event) => updateNumber("children", event.target.value)} /><em>명</em></div></label>
                <label><span>막내 생년월일</span><div><input type="date" disabled={profile.children === 0} value={profile.youngestChildBirthDate} onChange={(event) => updateField("youngestChildBirthDate", event.target.value)} /></div></label>
              </div>

              <fieldset className="fieldGroup segmentGroup">
                <legend>혼인 상태</legend>
                <div className="threeWay">
                  {(Object.keys(maritalLabels) as MaritalStatus[]).map((status) => <label className={profile.maritalStatus === status ? "checked" : ""} key={status}><input type="radio" name="maritalStatus" checked={profile.maritalStatus === status} onChange={() => updateField("maritalStatus", status)} />{maritalLabels[status]}</label>)}
                </div>
              </fieldset>

              {profile.maritalStatus !== "single" && <div className="inputGrid profileDateField"><label className="wide"><span>{profile.maritalStatus === "married" ? "혼인신고일" : "혼인예정일"}</span><div><input type="date" value={profile.marriageDate} onChange={(event) => updateField("marriageDate", event.target.value)} /></div></label></div>}

              <fieldset className="fieldGroup segmentGroup">
                <legend>거주지</legend>
                <div className="threeWay">
                  {([["seoul", "서울"], ["capital", "수도권(서울 외)"], ["other", "그 외"]] as [Residence, string][]).map(([value, label]) => (
                    <label className={profile.residence === value ? "checked" : ""} key={value}><input type="radio" name="residence" checked={profile.residence === value} onChange={() => updateField("residence", value)} />{label}</label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="fieldGroup segmentGroup">
                <legend>복지자격 (순위 판정용)</legend>
                <div className="threeWay">
                  {([["none", "해당 없음"], ["recipient", "수급자"], ["near-poor", "차상위"]] as [Welfare, string][]).map(([value, label]) => (
                    <label className={profile.welfare === value ? "checked" : ""} key={value}><input type="radio" name="welfare" checked={profile.welfare === value} onChange={() => updateField("welfare", value)} />{label}</label>
                  ))}
                </div>
              </fieldset>

              <div className="toggleStack">
                <label className="houseToggle"><div><strong>청약통장 보유</strong><span>주택청약종합저축 등</span></div><input type="checkbox" checked={profile.hasSubscriptionAccount} onChange={(event) => updateField("hasSubscriptionAccount", event.target.checked)} /></label>
                <label className="houseToggle"><div><strong>임신 중</strong><span>태아 포함 기준 확인용</span></div><input type="checkbox" checked={profile.isPregnant} onChange={(event) => updateField("isPregnant", event.target.checked)} /></label>
                <label className="houseToggle"><div><strong>한부모 가구</strong><span>특별공급 대상 확인용</span></div><input type="checkbox" checked={profile.isSingleParent} onChange={(event) => updateField("isSingleParent", event.target.checked)} /></label>
                <label className="houseToggle"><div><strong>주택 보유</strong><span>무주택 세대구성원 확인용</span></div><input type="checkbox" checked={profile.hasHouse} onChange={(event) => updateField("hasHouse", event.target.checked)} /></label>
              </div>

              {profile.hasSubscriptionAccount && (
                <div className="inputGrid profileDateField">
                  <label className="wide"><span>납입 인정 회차</span><div><input type="number" min="0" step="1" value={profile.subscriptionPaymentCount} onChange={(event) => updateNumber("subscriptionPaymentCount", event.target.value)} /><em>회</em></div></label>
                </div>
              )}

              <div className="privacyCard"><strong>입력값 보호</strong><p>프로필은 이 컴퓨터의 로컬 데이터베이스에만 저장하며 공식 API나 외부 서비스로 전송하지 않습니다. 알림이 브라우저를 열지 않고도 판정하기 위해 저장합니다. 자산·자동차는 원문에서 금액을 읽으면 자동 비교하고, 소득 기준표(가구원수별 금액)는 공고문에서 확인해야 합니다.</p></div>
            </div>

            <div className="profileDialogFooter">
              <button type="button" className="ghostButton" onClick={() => void loadProfile()}>되돌리기</button>
              <button className="conditionSearchButton" type="button" onClick={searchWithProfile}>내 조건으로 공고 찾기</button>
            </div>
          </div>
        </div>
      )}

      {sentNotice && <div className="toast" role="status" aria-live="assertive"><span>✓</span><div><strong>텔레그램 알림 미리보기</strong><p>“{sentNotice}” 알림 전송 화면을 확인했습니다.</p></div></div>}
    </main>
  );
}
