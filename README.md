# 집알림

서울과 출퇴근 가능한 수도권의 공공임대 모집공고를 모아, **내가 지원할 수 있는 공고와 실제로 살고 싶은 주택**을 빠르게 골라내는 개인용 도구입니다.

목표는 공고를 구경하는 것이 아니라 **당첨될 때까지 새 공고를 놓치지 않고 반복해서 지원하는 것**입니다.

```text
새 공고 발견 → 지원 가능 여부 → 실제 공급주택 → 생활권·선호 → 과거 경쟁률
→ 우선 확인 대상 → 알림 → 지원 준비 → 결과 기록 → 다음 공고
```

## 문서

이 프로젝트는 문서가 기준입니다. 작업 전에 위에서 아래로 읽습니다.

| 문서 | 내용 |
| --- | --- |
| [PRODUCT](docs/PRODUCT.md) | 목표, 제품 원칙, 운영 범위 |
| [REQUIREMENTS](docs/REQUIREMENTS.md) | 요구사항 R1~R48 |
| [DOMAIN](docs/DOMAIN.md) | 용어와 개념, 관계 |
| [ROADMAP](docs/ROADMAP.md) | Phase 0~11, 결정 기록 |
| [CURRENT](docs/CURRENT.md) | 이번 단계 범위와 완료 조건 |
| [SPEC](docs/SPEC.md) | 어떻게 만들 것인가 — 확정 스펙, 결정해야 할 것, 현재 코드와의 차이 |

## 현재 상태

**Phase 2. 공급주택 구조화** 진행 중입니다.

완료된 것

- 마이홈 API·SH 게시판에서 서울 전체 모집공고 수집 (후속공고 보관, 정정공고 구분, 중복 제거)
- 공고 안의 개별 공급주택 구조화 — 마이홈이 주는 주택 단위 행을 살리고, 단지정보 API에서 전용면적·주소·PNU·보증금·월임대료를 붙입니다
- 서울주거포털에서 SH 공고의 접수기간·발표일·모집상태·공급호수 보충
- 공고 단지명 ↔ 재고 건물명 조인. 이름이 어긋나면 잇지 않고 `미확보`로 둡니다
- `[수집]` 버튼과 `/api/sync` — 수집·저장·재고 갱신을 한 함수로 처리하고 실행 이력을 남깁니다
- 내보내기(`/api/export`) — 무료 티어에 백업이 없으므로 내 데이터를 한 파일로 받습니다
- 제목 기반 대상 계층 1차 분류, LH 상세에서 신청자격·임대조건·일정 추출, 공식 경쟁률만 표시

아직 없는 것

- 자동 동기화 등록 — `scripts/com.jib-alim.sync.plist`를 `launchctl`로 걸어야 09:00·18:00에 돕니다
- 포털에 없는 SH 공고(특화형 매입임대·사회주택 계열)의 접수기간 — 게시판 본문이나 첨부에만 있습니다
- 소득·자산·청약통장 기반 자격 판정 (Phase 3)
- 출퇴근 시간 판단, 경기도 공고 (Phase 4)
- 전세임대 전용 정보 (Phase 5), 과거 경쟁률 (Phase 6), 추천 (Phase 7)
- 텔레그램 알림 (Phase 8), 지원 이력 화면 (Phase 9)

> 화면의 분류 결과는 신청 자격 확정이 아닙니다. 소득·자산·세대구성원 범위와 공고별 예외조건은 공식 공고문으로 최종 확인해야 하며, 최종 청약 신청은 사용자가 직접 수행합니다.

## 실행

필요한 것

- Node.js `22.13.0` 이상 (확인 환경: Node `v22.19.0`, npm `10.9.3`)
- 공공데이터포털 일반 인증키 — 계정 인증키 하나로 승인된 모든 API를 호출합니다
- Supabase 프로젝트 (무료 티어)

```bash
git clone https://github.com/youngmeen/SHLH.git
cd SHLH
npm ci                       # lock 기준 설치. npm install 대신 사용합니다
cp .env.example .env.local
npm run dev
```

`.env.local`에 두 값을 넣습니다. 따옴표는 붙이지 않습니다.

```dotenv
DATA_GO_KR_API_KEY=공공데이터포털_일반인증키
DATABASE_URL=Supabase_Postgres_접속문자열
```

접속 문자열은 대시보드의 **Connection pooling**(Session mode, 5432)을 씁니다. 직접 연결(`db.<ref>.supabase.co`)은 IPv6 전용이라 IPv4 회선에서는 `ENOTFOUND`가 납니다. 사용자 이름이 `postgres.<project-ref>` 형식인지 확인하세요.

다른 컴퓨터로 옮길 때 Git을 쓰지 않는다면 `node_modules`, `.next`, `.env.local`을 제외하고 새로 만듭니다. 데이터는 Supabase에 있으므로 함께 옮길 필요가 없습니다.

### 저장 시작하기

```bash
npm run db:migrate           # notice · housing_unit · follow_up_notice · sync_run 등 7개 테이블 생성
curl -X POST http://localhost:3000/api/sync   # 화면의 [수집] 버튼과 같은 경로
curl http://localhost:3000/api/sync           # 마지막 동기화 기록
```

하루 2회(09:00·18:00) 자동 실행은 launchd에 걸어 둡니다. `npm run dev`가 떠 있어야 합니다.

```bash
cp scripts/com.jib-alim.sync.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jib-alim.sync.plist
tail -f ~/Library/Logs/jib-alim/sync.log
```

### 확인

```bash
npm run lint
npm test
```

화면에서 볼 것 — 상단에 공식 공고 연결 건수가 표시되는가, 공고를 선택하면 신청자격·임대조건이 로드되는가, 프로필을 저장하고 서버를 재시작해도 값이 남는가, `.env.local`이 없을 때 오류 메시지가 인증키를 노출하지 않는가.

### 문제 해결

**공고 목록이 비어 있다** — 대부분 `.env.local`에 인증키가 없는 경우입니다. SH 게시판은 키 없이도 수집되므로 SH 건수만 0이 아니면 마이홈 쪽 문제입니다.

**DB 연결이 안 된다** — Supabase 무료 프로젝트는 **1주 방치하면 일시정지**됩니다. 대시보드에서 재개해야 합니다. 하루 2회 동기화가 돌면 정지되지 않습니다.

**API가 403을 반환한다** — `SERVICE_KEY_IS_NOT_REGISTERED`는 그 API에 활용신청이 안 됐다는 뜻입니다(키 자체는 유효). 승인 상태, 변수명(`DATA_GO_KR_API_KEY`), 앞뒤 공백·따옴표, 개발계정 일일 호출 한도를 확인합니다.

**포트가 사용 중이다** — 터미널에 표시된 새 URL을 쓰거나 `npm run dev -- --port 3001`.

**목록은 되는데 상세만 실패한다** — 목록 수집과 상세 추출은 별도 요청입니다. LH·SH 원문 사이트가 느리거나 차단한 경우 정상적으로 발생합니다.

## 보안

- 인증키는 `.env.local`에만 저장하고 저장소·문서·화면 캡처에 남기지 않습니다.
- 공고 상세 조회는 공식 LH·SH 도메인만 허용합니다.
- 프로필과 지원 이력은 본인 소유의 Supabase 프로젝트에만 저장합니다. Data API는 쓰지 않고 서버에서 접속 문자열로만 접근합니다.
- 무료 티어는 백업이 없으므로 내보내기로 직접 보관합니다.
- 인증수단을 보관하지 않으며 청약을 자동 제출하지 않습니다.
