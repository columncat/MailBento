#!/bin/sh
# 설정이 있으면 앱, 없으면 설치 마법사.
#
# 이 앱은 암호화 키가 없으면 뜨지 못한다. 그래서 "설정이 없을 때도 뜨는 앱" 을
# 만드는 대신 여기서 갈라 준다 — 평생 한 번 쓰는 화면 때문에 늘 도는 코드의
# 검사를 무르게 할 이유가 없다.
#
# 마법사가 값을 다 적으면 스스로 끝나고, 도커가 다시 띄우면서 이 스크립트가
# 다시 돈다. 그때는 설정이 있으므로 앱으로 간다.
set -e

CONFIG_DIR="${BENTO_CONFIG_DIR:-/config}"
CONFIG="$CONFIG_DIR/mailbento.env"
DONE="$CONFIG_DIR/setup.json"

if [ ! -f "$DONE" ] || [ ! -f "$CONFIG" ]; then
  echo "[mailbento] 설정이 없습니다 — 설치 마법사를 엽니다."
  exec node /app/setup/server.js
fi

# set -a 로 감싸면 이 파일의 값이 그대로 환경변수가 된다.
set -a
# shellcheck disable=SC1090
. "$CONFIG"
set +a

echo "[mailbento] 설정을 읽었습니다. 앱을 시작합니다."
exec node server.js
