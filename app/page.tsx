"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { District, NoticeFeed } from "./lib/notice-types";
import { initialNoticeFeed } from "./lib/initial-notice-feed";
import { evaluateAudience, type HousingProfile, type MaritalStatus } from "./lib/audience-match";
import type { NoticeDetail } from "./lib/notice-detail";

type AgencyFilter = "all" | "LH" | "SH";
type ConditionView = "matched" | "all";
type Profile = HousingProfile & {
  districts: District[];
  householdSize: number;
  monthlyIncome: number;
  totalAssets: number;
  marriageDate: string;
  youngestChildBirthDate: string;
};

const districts: District[] = ["서초구", "강남구", "송파구"];
const defaultProfile: Profile = {
  districts,
  age: 31,
  householdSize: 1,
  monthlyIncome: 310,
  totalAssets: 22000,
  hasHouse: false,
  maritalStatus: "single",
  marriageDate: "",
  children: 0,
  youngestChildBirthDate: "",
  isPregnant: false,
  isSingleParent: false,
};

const maritalLabels: Record<MaritalStatus, string> = {
  single: "미혼",
  married: "기혼",
  prospective: "예비부부",
};

function formatDate(value: string | null) {
  if (!value) return "원문 확인";
  return value.replaceAll("-", ".");
}

function formatFetchedAt(value: string) {
  if (!value) return "수집 대기 중";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

  const loadNotices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/notices?refresh=${Date.now()}`, { headers: { Accept: "application/json" } });
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
  const visibleResults = agencyFilter === "all"
    ? conditionResults
    : conditionResults.filter(({ notice }) => notice.agency === agencyFilter);
  const selectedResult = visibleResults.find(({ notice }) => notice.id === selectedId) ?? visibleResults[0];
  const selected = selectedResult?.notice;
  const supportRecommendations = evaluatedNotices
    .filter(({ notice, fit }) => fit.status !== "mismatch" && notice.status !== "접수마감")
    .sort((a, b) => Number(b.fit.status === "likely") - Number(a.fit.status === "likely"))
    .slice(0, 3);
  const counts = {
    all: conditionResults.length,
    LH: conditionResults.filter(({ notice }) => notice.agency === "LH").length,
    SH: conditionResults.filter(({ notice }) => notice.agency === "SH").length,
  };

  useEffect(() => {
    if (!selected) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setNoticeDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      void fetch(`/api/notice-detail?sourceUrl=${encodeURIComponent(selected.sourceUrl)}`, {
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
  }, [selected]);

  function updateNumber(key: "age" | "householdSize" | "monthlyIncome" | "totalAssets" | "children", value: string) {
    setProfile((current) => ({ ...current, [key]: Math.max(0, Number(value) || 0) }));
  }

  function toggleDistrict(district: District) {
    setProfile((current) => ({
      ...current,
      districts: current.districts.includes(district)
        ? current.districts.filter((item) => item !== district)
        : [...current.districts, district],
    }));
  }

  function simulateTelegram(title: string) {
    setSentNotice(title);
    window.setTimeout(() => setSentNotice(null), 3200);
  }

  function searchWithProfile() {
    setConditionView("matched");
    document.getElementById("notice-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <a className="brand" href="#top" aria-label="집알림 처음으로"><span className="brandMark">집</span><span>집알림</span><small>BETA</small></a>
        <div className="headerStatus"><span className={`pulse ${error ? "warning" : ""}`} />{loading ? "공식 공고 확인 중" : `공식 공고 ${feed.notices.length}건 연결`}</div>
        <button className="telegramButton" type="button" onClick={() => void loadNotices()} disabled={loading}>{loading ? "불러오는 중" : "공고 새로고침"}</button>
      </header>

      <div className="demoBanner" role="note">
        <strong>실데이터 BETA</strong><span>마이홈 API와 SH 공식 게시판을 읽습니다. 신청 자격과 접수 가능 여부는 반드시 원문에서 최종 확인하세요.</span>
      </div>

      <div className="workspace" id="top">
        <aside className="profileSidebar">
          <div className="panelTitle"><div><p>MY PROFILE</p><h2>내 조건</h2></div><button type="button" onClick={() => setProfile(defaultProfile)}>초기화</button></div>

          <fieldset className="fieldGroup districtGroup">
            <legend>관심 지역</legend>
            <div className="chipGrid">
              {districts.map((district) => (
                <label className={profile.districts.includes(district) ? "checked" : ""} key={district}>
                  <input type="checkbox" checked={profile.districts.includes(district)} onChange={() => toggleDistrict(district)} />{district.replace("구", "")}
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
            <label><span>막내 생년월일</span><div><input type="date" disabled={profile.children === 0} value={profile.youngestChildBirthDate} onChange={(event) => setProfile((current) => ({ ...current, youngestChildBirthDate: event.target.value }))} /></div></label>
          </div>

          <fieldset className="fieldGroup segmentGroup">
            <legend>혼인 상태</legend>
            <div className="threeWay">
              {(["single", "married", "prospective"] as MaritalStatus[]).map((status) => <label className={profile.maritalStatus === status ? "checked" : ""} key={status}><input type="radio" name="maritalStatus" checked={profile.maritalStatus === status} onChange={() => setProfile((current) => ({ ...current, maritalStatus: status }))} />{maritalLabels[status]}</label>)}
            </div>
          </fieldset>

          {profile.maritalStatus !== "single" && <div className="inputGrid profileDateField"><label className="wide"><span>{profile.maritalStatus === "married" ? "혼인신고일" : "혼인예정일"}</span><div><input type="date" value={profile.marriageDate} onChange={(event) => setProfile((current) => ({ ...current, marriageDate: event.target.value }))} /></div></label></div>}

          <div className="toggleStack">
            <label className="houseToggle"><div><strong>임신 중</strong><span>태아 포함 기준 확인용</span></div><input type="checkbox" checked={profile.isPregnant} onChange={(event) => setProfile((current) => ({ ...current, isPregnant: event.target.checked }))} /></label>
            <label className="houseToggle"><div><strong>한부모 가구</strong><span>특별공급 대상 확인용</span></div><input type="checkbox" checked={profile.isSingleParent} onChange={(event) => setProfile((current) => ({ ...current, isSingleParent: event.target.checked }))} /></label>
            <label className="houseToggle"><div><strong>주택 보유</strong><span>무주택 세대구성원 확인용</span></div><input type="checkbox" checked={profile.hasHouse} onChange={(event) => setProfile((current) => ({ ...current, hasHouse: event.target.checked }))} /></label>
          </div>

          <button className="conditionSearchButton" type="button" onClick={searchWithProfile}>내 조건으로 공고 찾기</button>

          <div className="privacyCard"><strong>입력값 보호</strong><p>프로필은 현재 화면에서만 사용하며 공식 API나 외부 서비스로 전송하지 않습니다. 소득·자산 자동판정은 상세 기준 구조화 후 연결됩니다.</p></div>
        </aside>

        <section className="dashboard">
          <div className="dashboardIntro">
            <div><p className="eyebrow">서울 공공임대 공고 모니터</p><h1>내 조건으로 확인할 공고가<br /><em>{loading ? "···" : `${conditionResults.length}건`}</em> 있습니다.</h1><p>명백히 다른 대상 공고는 추천에서 제외하고, 전체 공고에서는 모두 볼 수 있습니다.</p></div>
            <div className="scanCard">
              <span>최근 공식 수집</span><strong>{formatFetchedAt(feed.fetchedAt)}</strong>
              <small>{feed.sources.filter((source) => source.ok).length}/{feed.sources.length || 2}개 소스 정상</small>
              <i>{error ? "일부 지연" : "15분 캐시"}</i>
            </div>
          </div>

          <div className="summaryCards">
            <button type="button" onClick={() => setAgencyFilter("all")} className={agencyFilter === "all" ? "active" : ""}><span className="summaryIcon success">합</span><div><small>전체 공고</small><strong>{counts.all}</strong></div></button>
            <button type="button" onClick={() => setAgencyFilter("LH")} className={agencyFilter === "LH" ? "active" : ""}><span className="summaryIcon caution">LH</span><div><small>마이홈·LH</small><strong>{counts.LH}</strong></div></button>
            <button type="button" onClick={() => setAgencyFilter("SH")} className={agencyFilter === "SH" ? "active" : ""}><span className="summaryIcon muted">SH</span><div><small>SH 공식</small><strong>{counts.SH}</strong></div></button>
          </div>

          <div className="sourceStatus" aria-live="polite">
            {feed.sources.map((source) => <a href={source.sourceUrl} target="_blank" rel="noreferrer" key={source.id}><span className={`sourceDot ${source.ok ? "ok" : "fail"}`} /><strong>{source.label}</strong><small>{source.ok ? `${source.count}건 수집` : source.message}</small></a>)}
            {error && <p>{error}</p>}
          </div>

          <section className="recommendationBoard" aria-labelledby="recommendation-title">
            <div className="recommendationHeader"><div><p>MY SHORTLIST</p><h2 id="recommendation-title">우선 확인할 공고</h2></div><span>경쟁률이 아니라 입력 조건과 접수 상태 기준</span></div>
            <div className="recommendationList">
              {supportRecommendations.map(({ notice, fit }, index) => (
                <button type="button" key={notice.id} onClick={() => setSelectedId(notice.id)}>
                  <b>{index + 1}</b>
                  <span><small>{fit.status === "likely" ? "지원 검토 추천" : "자격 추가 확인"}</small><strong>{notice.title}</strong><em>{fit.detail}</em></span>
                  <i>{notice.supplyCount ?? "공급 규모 원문 확인"}</i>
                </button>
              ))}
              {supportRecommendations.length === 0 && <div className="recommendationEmpty"><strong>현재 바로 추천할 공고가 없습니다.</strong><span>조건을 보완하거나 전체 공고에서 추가 자격을 확인해 주세요.</span></div>}
            </div>
          </section>

          <div className="listHeader" id="notice-results">
            <div><h2>실제 모집공고</h2><span>{visibleResults.length}개 결과</span></div>
            <div className="listControls">
              <div className="filters" aria-label="조건 필터">
                <button type="button" className={conditionView === "matched" ? "active" : ""} onClick={() => setConditionView("matched")}>조건 추천</button>
                <button type="button" className={conditionView === "all" ? "active" : ""} onClick={() => setConditionView("all")}>전체 공고</button>
              </div>
              <div className="filters" aria-label="공급기관 필터">
                {(["all", "LH", "SH"] as AgencyFilter[]).map((item) => <button type="button" key={item} className={agencyFilter === item ? "active" : ""} onClick={() => setAgencyFilter(item)}>{item === "all" ? "전체" : item}</button>)}
              </div>
            </div>
          </div>

          <div className="noticeList" aria-busy={loading}>
            {loading && visibleResults.length === 0 && <div className="emptyState"><strong>공식 공고를 확인하고 있습니다.</strong><p>마이홈과 SH 소스를 순서대로 읽는 중입니다.</p></div>}
            {visibleResults.map(({ notice, fit }) => (
              <article className={`noticeCard ${selected?.id === notice.id ? "selected" : ""} ${fit.status === "mismatch" ? "mismatch" : ""}`} key={notice.id}>
                <div className="noticeMain">
                  <div className="noticeMeta"><span className={`agency ${notice.agency.toLowerCase()}`}>{notice.agency}</span><span>{notice.region}</span><span>{notice.housingType}</span><span>공식 데이터</span></div>
                  <h3>{notice.title}</h3><p>{notice.department ? `${notice.department} 제공` : "공식 공고 원문에서 세부 내용을 확인하세요."}</p>
                  <div className="noticeFacts">
                    <span><small>게시일</small><strong>{formatDate(notice.publishedAt)}</strong></span>
                    <span><small>접수 시작</small><strong>{formatDate(notice.applyStart)}</strong></span>
                    <span><small>접수 마감</small><strong>{formatDate(notice.applyEnd)}</strong></span>
                    <span><small>공급 규모</small><strong>{notice.supplyCount ?? "원문 확인"}</strong></span>
                  </div>
                </div>
                <div className="matchPanel">
                  <div className="statusGroup"><span className={`fitPill ${fit.status}`}>{fit.label}</span><span className={`statusPill ${statusClass(notice.status)}`}>{notice.status}</span></div>
                  <div className="sourceStamp"><strong>{notice.agency}</strong><small>공식 원문 연결</small></div>
                  <button type="button" onClick={() => setSelectedId(notice.id)}>공고 확인하기</button>
                </div>
              </article>
            ))}
            {!loading && visibleResults.length === 0 && <div className="emptyState"><strong>현재 내 조건에 추천할 공고가 없습니다.</strong><p>‘전체 공고’에서 제외된 공고를 확인하거나 관심 지역·공급기관을 바꿔 주세요.</p><button type="button" onClick={() => setConditionView("all")}>전체 공고 보기</button></div>}
          </div>

          {selected && (
            <section className="detailPanel" aria-live="polite">
              <div className="detailHeader"><div><p>공식 공고 상세 확인</p><h2>{selected.title}</h2></div><div className="detailActions"><a href={selected.sourceUrl} target="_blank" rel="noreferrer">공식 신청 페이지</a><button type="button" onClick={() => simulateTelegram(selected.title)}>텔레그램 알림 미리보기</button></div></div>
              <div className="decisionStrip">
                <div><small>추천 판단</small><strong>{selectedResult.fit.status === "likely" ? "지원 검토 추천" : selectedResult.fit.status === "review" ? "자격 확인 후 검토" : "현재 조건으로 비추천"}</strong><p>{selectedResult.fit.detail}</p></div>
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
                  <div className={selectedResult.fit.status === "likely" ? "pass" : selectedResult.fit.status === "mismatch" ? "fail" : "manual"}><span>{selectedResult.fit.status === "likely" ? "✓" : selectedResult.fit.status === "mismatch" ? "×" : "!"}</span><div><strong>공고 대상 신호 · {selectedResult.fit.label}</strong><small>{selectedResult.fit.detail}</small></div></div>
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
        </section>
      </div>

      <footer><div><span className="brandMark">집</span><strong>집알림 실데이터 MVP</strong></div><p>국토교통부 마이홈 API · SH 공식 공고</p><p>다음 단계: 자격 기준 구조화와 Telegram Bot 연결</p></footer>

      {sentNotice && <div className="toast" role="status" aria-live="assertive"><span>✓</span><div><strong>텔레그램 알림 미리보기</strong><p>“{sentNotice}” 알림 전송 화면을 확인했습니다.</p></div></div>}
    </main>
  );
}
