#!/bin/sh
# 하루 두 번(09:00·18:00) 동기화를 호출한다. launchd가 이 스크립트를 실행한다.
#
# 화면의 [수집] 버튼과 **같은 엔드포인트**를 부른다(SPEC S6). 두 경로가 갈라지면
# 스케줄에서만 나는 버그가 생긴다.
#
# 전제: `npm run dev`(또는 `npm start`)가 떠 있어야 한다. 서버가 없으면 이 호출은
# 실패하고 로그에 남는다. 맥이 절전이면 그 시각에 실행되지 않고, launchd는 깨어난
# 직후 한 번 실행한다(SPEC S6의 알려진 한계).
set -eu

BASE_URL="${JIB_ALIM_URL:-http://127.0.0.1:3000}"
LOG_DIR="${JIB_ALIM_LOG_DIR:-$HOME/Library/Logs/jib-alim}"
mkdir -p "$LOG_DIR"

STAMP="$(date '+%Y-%m-%d %H:%M:%S')"
RESPONSE="$(curl -sS -m 900 -X POST "$BASE_URL/api/sync?trigger=schedule" -H 'Accept: application/json' 2>&1)" || RESPONSE="curl 실패: $RESPONSE"

# 인증키·접속 문자열이 로그에 남지 않도록 응답 본문만 적는다(R45).
printf '%s %s\n' "$STAMP" "$RESPONSE" >> "$LOG_DIR/sync.log"
