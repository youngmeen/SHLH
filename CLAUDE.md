# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 명령어

```bash
npm ci                 # 의존성 설치 (npm install 대신 lock 기준으로)
npm run dev            # 개발 서버 (http://localhost:3000, 포트 점유 시 3001…)
npm run build          # 배포 빌드 → dist/
npm run lint           # eslint
npm test               # build 후 tests/*.test.mjs 전체 실행
npm run db:generate    # drizzle-kit generate (스키마 사용 시)
```

단일 테스트:

```bash
node --test tests/audience-match.test.mjs   # 소스 직접 import, 빌드 불필요
npm run build && node --test tests/rendered-html.test.mjs  # dist/server/index.js 필요
```

`.env.local`에 `MOLIT_MYHOME_API_KEY`가 있어야 공고 수집이 동작한다. 없으면 목록이 비어 보인다.

## 실행 스택

Next.js App Router 문법을 쓰지만 **런타임은 Next.js 개발 서버가 아니라 vinext(Vite) + Cloudflare Workers**다. 이 차이가 디버깅에서 자주 문제가 된다.

- 진입점은 `worker/index.ts` (Cloudflare Worker). `vinext/server/app-router-entry`가 App Router를 처리하고, `/_vinext/image`만 워커가 직접 가로채 이미지 최적화를 한다.
- `vite.config.ts`가 `.openai/hosting.json`을 읽어 D1·R2 바인딩을 조립한다. **`d1`은 `"DB"`로 켜져 있고 `r2`는 `null`이다.** D1은 배포 없이 Miniflare가 로컬에서 제공하며 상태는 `.wrangler/state/v3/d1/`에 SQLite 파일로 남는다(gitignore됨). 서버를 재시작해도 데이터가 유지된다.
- `db/index.ts`의 `getDb()`는 바인딩이 없으면 예외를 던지고, `getReadyDb()`는 `db/schema.ts`의 `SCHEMA_STATEMENTS`로 테이블을 보장한 뒤 핸들을 준다. 이 템플릿은 drizzle 마이그레이션을 배포 시 플랫폼이 적용하는 모델이라 로컬에는 적용 경로가 없어서 앱이 직접 만든다. 손으로 쓴 생성문과 `npm run db:generate` 산출물이 어긋나면 `tests/schema-drift.test.mjs`가 잡는다.
- 바인딩은 `cloudflare:workers`에서 직접 import하지 않는다. `worker/index.ts`가 요청마다 `setWorkerBindings(env)`로 넣어준다. 그 모듈은 워커 런타임에만 있어서, 서버 번들을 순수 Node로 불러오는 `tests/rendered-html.test.mjs`가 로드 단계에서 깨지기 때문이다.
- `.openai/hosting.json`은 이 프로젝트가 vinext-starter 템플릿에서 나왔기 때문에 남아 있는 것이다. 같은 이유로 있던 `app/chatgpt-auth.ts`(`oai-authenticated-user-*` 헤더를 읽던 미사용 파일)는 삭제했다.
- `next.config.ts`는 사실상 비어 있다. Next.js 설정을 늘리기 전에 vinext가 그 옵션을 지원하는지 확인할 것.

## 데이터 흐름

1. `app/lib/initial-notice-feed.ts`의 최근 정상 스냅샷으로 서버 렌더링 → 화면이 즉시 뜬다.
2. 브라우저가 `/api/notices`를 호출해 실제 공고로 교체한다 (`app/lib/notice-sources.ts`가 국토부 마이홈 API + SH 게시판 HTML을 읽어 공통 형식으로 변환).
3. 프로필을 바꾸면 서버 왕복 없이 브라우저에서 `app/lib/audience-match.ts`가 관련도를 다시 계산한다.
4. 공고 선택 시 `/api/notice-detail`이 해당 공식 페이지만 읽고 `app/lib/notice-detail.ts`가 신청자격·임대조건·일정 구간을 뽑는다.

캐시: 목록 15분(오류 시 1시간 이전 응답 재사용), 상세 6시간(오류 시 24시간). 목록은 정상인데 상세만 실패하는 경우가 정상적으로 존재한다 — 별도 요청이기 때문이다.

화면은 `app/page.tsx` 한 파일(356줄)에 프로필 입력·추천·목록·상세가 모두 들어 있고, 스타일은 `app/globals.css`에 모여 있다.

## 이 프로젝트의 금지 사항

`docs/HANDOFF.md`에 정리된 원칙이며, 데이터 신뢰성이 이 서비스의 핵심이라 반드시 지킨다.

- 상세 추출 API에 `apply.lh.or.kr`, `i-sh.co.kr`, `www.i-sh.co.kr` 외의 URL을 허용하지 않는다.
- 전세임대 공고에 실제 공급주택이 있는 것처럼 가상 좌표·핀을 만들지 않는다. 주소도 단지 식별자도 없으면 구 단위 영역으로 표시한다.
- 신청건수를 공식 최종 경쟁률로 표현하지 않는다. `경쟁률 숫자 : 1` 형태가 공식 페이지에 있을 때만 표시하고, 없으면 `아직 집계 전`이다.
- 공고 제목만으로 신청 가능을 확정하지 않는다. 현재 판정은 제목 기반 1차 관련도이며 소득·자산·세대구성원 기준은 아직 구조화되지 않았다.
- 사용자 확인 없이 실제 청약을 자동 제출하지 않는다.
- 인증키를 브라우저 응답·HTML·오류 메시지에 노출하지 않는다. 사용자 프로필은 브라우저 메모리에만 두고 외부로 전송하지 않는다.

## 현재 상태

실데이터 로컬 MVP. 원격 저장소 미연결, 텔레그램 실제 전송 미연결, 지도 미구현.

**요구사항과 단계 순서는 `docs/superpowers/specs/2026-08-19-집알림-요구사항-design.md`가 기준이다** (`docs/ROADMAP.md`보다 우선). 0단계(수집 완전성)와 1단계(D1·프로필 저장)는 완료했다. 수집 범위는 서울 전체이고, 프로필은 로컬 D1에 1행으로 저장한다.
