# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 문서가 기준이다

작업 전에 이 순서로 읽는다.

1. `docs/PRODUCT.md` — 목표, 제품 원칙, 운영 범위
2. `docs/REQUIREMENTS.md` — 요구사항 R1~R48
3. `docs/DOMAIN.md` — 용어와 개념 (Notice / SupplyCategory / HousingUnit / Eligibility …)
4. `docs/ROADMAP.md` — Phase 0~11과 결정 기록
5. `docs/CURRENT.md` — **이번 단계 범위. 구현 범위는 이 문서를 최우선으로 따른다**

기술 문서: `docs/SPEC.md` — 어떻게 만들 것인가. 확정된 스펙, 아직 정하지 않은 스펙(S1~S7), 현재 코드와 스펙의 차이(G1~G9), 확인한 사실과 확인하지 못한 것.

**현재 단계는 Phase 2(공급주택 구조화)다.**

## 작업 규칙

- 현재 Phase와 관계없는 기능은 발견하더라도 구현하지 않고 `docs/SPEC.md` 3절에 적는다.
- 한 번에 여러 Phase를 동시에 구현하지 않는다.
- 각 Phase 착수 시 구현 계획을 먼저 쓴다 (현재 상태 / 목표 / 변경 대상 / 하지 않는 것 / 테스트 방법 / 완료 조건).
- 기존 코드가 이미 제공하는 기능을 확인한 뒤 수정한다. 같은 기능을 새로 만들지 않는다.
- 상위 문서와 충돌하는 구현은 하지 않는다. 문서가 틀렸다면 문서를 먼저 고친다.

## 실행

```bash
npm run dev     # 개발 서버 (http://localhost:3000)
npm run lint
npm test
```

`.env.local`에 두 개가 있어야 한다.

- `DATA_GO_KR_API_KEY` — 공공데이터포털 일반 인증키. 계정 인증키 하나로 활용신청이 승인된 모든 API를 호출한다
- `DATABASE_URL` — Supabase Postgres 접속 문자열

**스택: Node + Next.js + Supabase Postgres(Drizzle).** 2026-08-20에 Cloudflare Workers·vinext·로컬 D1에서 옮겼다. 이유와 이동 범위는 `docs/SPEC.md` S1에 있다. 저장소는 Supabase 무료 티어이며 **백업이 없고 1주 방치 시 일시정지**되므로 내보내기를 유지한다.

## 이 프로젝트의 금지 사항

데이터 신뢰성이 이 도구의 핵심이다. 요구사항 근거를 함께 적는다.

- 공식 자료에서 확인되지 않은 주소·경쟁률·공급주택·세대수를 만들지 않는다 (R44).
- 전세임대 공고에 실제 공급주택이 있는 것처럼 다루지 않는다 (R28).
- 신청 건수를 공식 경쟁률처럼 표현하지 않는다. `경쟁률 숫자 : 1`이 공식 페이지에 있을 때만 표시한다 (R26).
- 조회 실패 / 정보 없음 / 미발표를 같은 상태로 표시하지 않는다 (R43).
- 공고 제목만으로 지원 가능·불가를 확정하지 않는다. 정보가 부족하면 `확인 필요`다 (R14).
- 공고 상세 조회에 `apply.lh.or.kr`, `i-sh.co.kr`, `www.i-sh.co.kr` 외의 URL을 허용하지 않는다 (R46).
- 인증키를 브라우저 응답·HTML·오류 메시지·로그에 노출하지 않는다 (R45).
- 프로필을 외부로 전송하지 않는다. 인증수단을 보관하지 않는다 (R47·R48).
- 사용자 확인 없이 청약을 자동 제출하지 않는다 (R34).
