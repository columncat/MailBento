#!/usr/bin/env bash
# 저장소들을 받아 스택을 띄운다. 이미 있으면 최신으로 당긴다.
#
# 처음 한 번:
#   ./bootstrap.sh
#   브라우저로 http://<주소>:3000 → 설치 마법사
#
# 나중에 갱신할 때도 같은 명령이다. 설정과 데이터는 ./config, ./data 에
# 있으므로 다시 빌드해도 남는다.
set -euo pipefail

cd "$(dirname "$0")"

# 저장소에서 받은 것으로 자신을 갈아 끼울 수 있으므로, 시작할 때의 모습을
# 기억해 둔다 (아래에서 바뀌었는지 비교한다).
BOOTSTRAP_HASH="$(cksum < "$0")"
export BOOTSTRAP_HASH

OWNER="${BENTO_GITHUB_OWNER:-columncat}"
REF="${BENTO_REF:-main}"
REPOS="MailBento MemoBento PaperBento BentoAgent"

# compose 는 v2 플러그인일 수도, v1 독립 실행 파일일 수도 있다.
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "docker compose 를 찾지 못했습니다." >&2
  exit 1
fi

mkdir -p src config data

for r in $REPOS; do
  if [ -d "src/$r/.git" ]; then
    echo "── $r 갱신"
    git -C "src/$r" fetch --depth 1 origin "$REF"
    git -C "src/$r" reset --hard "origin/$REF"
  elif [ -d "src/$r" ]; then
    # 손으로 올려 둔 소스. BentoAgent 는 비공개라 이 기계에 GitHub 자격이
    # 없으면 받아 올 수 없다 — 그때는 다른 데서 복사해 넣고 그대로 쓴다.
    echo "── $r 은 이미 있습니다 (git 저장소가 아님) — 그대로 씁니다"
  else
    echo "── $r 받기"
    if ! git clone --depth 1 -b "$REF" "https://github.com/$OWNER/$r.git" "src/$r"; then
      echo
      echo "  $r 을 받지 못했습니다. 비공개 저장소라면 이 기계에 GitHub 자격이" >&2
      echo "  없는 것입니다. 소스를 src/$r 에 직접 올려 두고 다시 실행하세요." >&2
      exit 1
    fi
  fi
done

# 스택 정의는 MailBento 저장소가 들고 있다. 처음 받아 둔 사본을 그대로 두면
# compose 가 바뀌어도 반영되지 않는다 — 볼륨을 하나 더 물리게 됐는데도 옛
# 정의로 계속 뜨는 식이다. 받은 것으로 맞춘다.
#
# 이 파일에는 이 기계에만 해당하는 값이 없다. 포트 같은 것은 옆의 .env 에서
# 읽으므로 덮어써도 잃을 것이 없다.
#
# **도는 중인 자기 자신을 제자리에 덮어쓰면 안 된다.**
#
# bash 는 스크립트를 통째로 읽어 두지 않는다. 열어 둔 파일의 바이트 위치를
# 기억했다가 필요할 때 이어 읽는데, 그 사이 파일 내용이 길이까지 바뀌면
# **새 내용의 옛 위치**부터 읽는다. 그 자리가 문장 한가운데면 글이 깨진다.
#
#   ./bootstrap.sh: line 70: syntax error near unexpected token `fi'
#
# 논문함을 처음 얹던 날 실제로 이렇게 멎었다. 다시 실행하면 넘어가서 한 번
# 겪고 잊기 쉬운데, **bootstrap.sh 의 길이가 바뀌는 날마다 첫 실행이 깨진다.**
#
# `mv` 는 inode 를 건드리지 않고 디렉터리의 이름만 갈아 끼운다. 도는 쪽은
# 열어 둔 옛 inode 를 그대로 붙들고 끝까지 온전히 읽는다. 새 것은 그다음
# 실행부터 — 바로 아래 respawn 이 그 일을 한다.
for f in docker-compose.yml bootstrap.sh; do
  src="src/MailBento/deploy/$f"
  [ -f "$src" ] || continue
  if ! cmp -s "$src" "$f"; then
    echo "── $f 갱신"
    cp "$src" "$f.new"
    [ "$f" = "bootstrap.sh" ] && chmod +x "$f.new"
    mv -f "$f.new" "$f"
  fi
done

# bootstrap.sh 자신이 바뀌었으면 새 것으로 다시 시작한다. 낡은 절차로 끝까지
# 가면 방금 받은 정의와 어긋난다.
if [ "${BENTO_RESPAWNED:-}" != "1" ] && [ -n "${BOOTSTRAP_HASH:-}" ] \
   && [ "$BOOTSTRAP_HASH" != "$(cksum < bootstrap.sh)" ]; then
  echo "── bootstrap.sh 가 바뀌었습니다. 새 것으로 다시 시작합니다."
  BENTO_RESPAWNED=1 exec ./bootstrap.sh "$@"
fi

# 에이전트 이미지는 두 앱의 mcp/ 를 GitHub 에서 받아 만든다. 도커가 그 층을
# 캐시하므로 저장소가 바뀐 날에는 값을 바꿔 줘야 다시 받는다. 그러지 않으면
# 앱 API 가 바뀐 날 에이전트만 옛 MCP 를 들고 조용히 404 를 받는다.
BENTO_MCP_CACHEBUST="$(git -C src/MemoBento rev-parse --short HEAD 2>/dev/null || echo x)-$(git -C src/MailBento rev-parse --short HEAD 2>/dev/null || echo x)"
export BENTO_MCP_CACHEBUST

echo "── 빌드"
$COMPOSE build

# 앱들은 컨테이너 안에서 nodejs(uid 1001)로 돈다. 그런데 여기서 만든 폴더는
# 이 계정(대개 uid 1000) 소유라, 그대로 두면 앱이 설정을 읽지도 데이터를
# 쓰지도 못한다. 호스트에 sudo 가 없어도 되도록 컨테이너 안에서 바로잡는다.
echo "── 권한 맞추기"
$COMPOSE run --rm --no-deps --user 0 --entrypoint sh mailbento \
  -c 'chown -R 1001:1001 /config /app/data' >/dev/null
$COMPOSE run --rm --no-deps --user 0 --entrypoint sh memobento \
  -c 'chown -R 1001:1001 /app/data' >/dev/null
$COMPOSE run --rm --no-deps --user 0 --entrypoint sh paperbento \
  -c 'chown -R 1001:1001 /app/data' >/dev/null

echo "── 시작"
$COMPOSE up -d

echo
if [ -f config/setup.json ]; then
  echo "이미 설정돼 있습니다. 그대로 올라옵니다."
else
  port="${MAILBENTO_PORT:-3000}"
  echo "설치 마법사가 열려 있습니다 — 브라우저로 http://<이 기계 주소>:${port} 를 여세요."
fi
