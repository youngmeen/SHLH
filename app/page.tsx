"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SEOUL_DISTRICTS, shortDistrictName, type District, type NoticeFeed } from "./lib/notice-types";
import { initialNoticeFeed } from "./lib/initial-notice-feed";
import { evaluateAudience, type AudienceStatus, type MaritalStatus } from "./lib/audience-match";
import { defaultProfile, parseProfile, type Profile } from "./lib/profile";
import type { NoticeDetail } from "./lib/notice-detail";

type AgencyFilter = "all" | "LH" | "SH";
type ConditionView = "matched" | "all";
type SaveState = "idle" | "saving" | "saved" | "error";

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
  const [selectedId, setSelectedId] = useState("");
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
  const selectedResult = visibleResults.find(({ notice }) => notice.id === selectedId) ?? visibleResults[0];
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

  function updateNumber(key: "age" | "householdSize" | "monthlyIncome" | "totalAssets" | "children", value: string) {
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

  const profileSummary = `${profile.age}세 · ${profile.householdSize}인 · ${profile.monthlyIncome.toLocaleString()}만원`;
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
        </div>
      </div>

      {error && <p className="summaryError" role="status">{error}</p>}

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

              <div className="detailGrid">
                <div className="checks">
                  <div className="pass"><span>✓</span><div><strong>관심 지역</strong><small>{selected.region}</small></div></div>
                  <div className="manual"><span>!</span><div><strong>월소득 기준</strong><small>입력 {profile.monthlyIncome.toLocaleString()}만원 · 원문 기준 확인 필요</small></div></div>
                  <div className="manual"><span>!</span><div><strong>총자산 기준</strong><small>입력 {profile.totalAssets.toLocaleString()}만원 · 원문 기준 확인 필요</small></div></div>
                  <div className={fitPresentation[selectedResult.fit.status].tone}><span>{fitPresentation[selectedResult.fit.status].mark}</span><div><strong>공고 대상 신호 · {selectedResult.fit.label}</strong><small>{selectedResult.fit.detail}</small></div></div>
                  <div className="manual"><span>!</span><div><strong>혼인·가구 조건</strong><small>{maritalLabels[profile.maritalStatus]} · {profile.householdSize}인 가구{profile.isSingleParent ? " · 한부모" : ""}</small></div></div>
                  <div className="manual"><span>!</span><div><strong>자녀·출산 조건</strong><small>자녀 {profile.children}명{profile.isPregnant ? " · 임신 중" : ""}{profile.youngestChildBirthDate ? ` · 막내 ${profile.youngestChildBirthDate}` : ""}</small></div></div>
                  <div className="manual"><span>!</span><div><strong>무주택 조건</strong><small>{profile.hasHouse ? "주택 보유 입력 · 신청 제한 가능성 확인" : "무주택 입력 · 세대구성원 범위 확인 필요"}</small></div></div>
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
                <label><span>나이</span><div><input type="number" min="19" max="100" value={profile.age} onChange={(event) => updateNumber("age", event.target.value)} /><em>세</em></div></label>
                <label><span>가구원</span><div><input type="number" min="1" max="10" value={profile.householdSize} onChange={(event) => updateNumber("householdSize", event.target.value)} /><em>명</em></div></label>
                <label className="wide"><span>세대 월소득</span><div><input type="number" min="0" step="10" value={profile.monthlyIncome} onChange={(event) => updateNumber("monthlyIncome", event.target.value)} /><em>만원</em></div></label>
                <label className="wide"><span>총자산</span><div><input type="number" min="0" step="100" value={profile.totalAssets} onChange={(event) => updateNumber("totalAssets", event.target.value)} /><em>만원</em></div></label>
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

              <div className="toggleStack">
                <label className="houseToggle"><div><strong>임신 중</strong><span>태아 포함 기준 확인용</span></div><input type="checkbox" checked={profile.isPregnant} onChange={(event) => updateField("isPregnant", event.target.checked)} /></label>
                <label className="houseToggle"><div><strong>한부모 가구</strong><span>특별공급 대상 확인용</span></div><input type="checkbox" checked={profile.isSingleParent} onChange={(event) => updateField("isSingleParent", event.target.checked)} /></label>
                <label className="houseToggle"><div><strong>주택 보유</strong><span>무주택 세대구성원 확인용</span></div><input type="checkbox" checked={profile.hasHouse} onChange={(event) => updateField("hasHouse", event.target.checked)} /></label>
              </div>

              <div className="privacyCard"><strong>입력값 보호</strong><p>프로필은 이 컴퓨터의 로컬 데이터베이스에만 저장하며 공식 API나 외부 서비스로 전송하지 않습니다. 알림이 브라우저를 열지 않고도 판정하기 위해 저장합니다. 소득·자산 자동판정은 상세 기준 구조화 후 연결됩니다.</p></div>
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
