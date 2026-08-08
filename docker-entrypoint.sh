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

# 설정을 환경변수로 직접 받는 배포는 예전 그대로 둔다.
#
# 이 갈림길이 없으면 멀쩡히 돌던 배포가 다음 이미지에서 설치 마법사로 바뀐다.
# 실제로 그랬다 — compose 가 환경변수로 값을 넘겨 주고 있었는데 /config 가
# 비어 있다는 이유로 앱 대신 마법사가 떴다.
#
# 마법사는 스택이 관리하는 배포(BENTO_MANAGED=1)에서만 쓴다. 그 표시가 없어도
# 암호화 키가 이미 환경에 있으면 누군가 손으로 설정해 둔 것이므로 그대로 간다.
if [ "${BENTO_MANAGED:-}" != "1" ] && [ -n "${ENCRYPTION_KEY:-}" ]; then
  echo "[mailbento] 환경변수로 설정된 배포입니다. 앱을 시작합니다."
  exec node server.js
fi

# 마법사가 여기에 적어야 한다. 못 적으면 폼을 다 채운 뒤에야 실패하므로
# 시작할 때 미리 확인한다.
if [ ! -w "$CONFIG_DIR" ]; then
  echo "[mailbento] $CONFIG_DIR 에 쓸 수 없습니다 (지금 uid=$(id -u))." >&2
  echo "  호스트 폴더의 주인이 다릅니다. 스택 폴더에서 아래를 한 번 돌리세요:" >&2
  echo "    docker compose run --rm --no-deps --user 0 --entrypoint sh mailbento \\" >&2
  echo "      -c 'chown -R 1001:1001 /config /app/data'" >&2
  echo "  bootstrap.sh 로 띄우면 이 일을 알아서 합니다." >&2
  exit 1
fi

if [ ! -f "$DONE" ] || [ ! -f "$CONFIG" ]; then
  echo "[mailbento] 설정이 없습니다 — 설치 마법사를 엽니다."
  exec node /app/setup/server.js
fi

if [ ! -r "$CONFIG" ]; then
  echo "[mailbento] $CONFIG 를 읽을 수 없습니다 (지금 uid=$(id -u))." >&2
  echo "  위와 같은 chown 을 한 번 돌리면 됩니다." >&2
  exit 1
fi

# set -a 로 감싸면 이 파일의 값이 그대로 환경변수가 된다.
set -a
# shellcheck disable=SC1090
. "$CONFIG"
set +a

echo "[mailbento] 설정을 읽었습니다. 앱을 시작합니다."
exec node server.js
