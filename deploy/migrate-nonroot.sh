#!/usr/bin/env bash
# 에이전트·커넥터를 root 에서 uid 1001 로 옮기는 날 한 번 돌린다.
#
#   cd <스택 폴더>            # docker-compose.yml, data/ 가 있는 곳
#   bash src/MailBento/deploy/migrate-nonroot.sh [스택 폴더]
#
# 왜 필요한가: 2026-11-22 전까지 BentoAgent 와 BentoConnector 는 root 로 돌았다.
# 그동안 만든 파일(data/bentoagent 의 세션·예약, data/claude-home 의 대화 기록
# 0600, data/bentoconnector/connector.json 0600)은 root 나 호스트 계정 소유라
# 1001 로 뜬 새 컨테이너는 읽지도 쓰지도 못한다 — 봇이 대화 맥락을 잃고, 커넥터는
# 등록된 클라이언트를 못 읽어 Claude 웹 연결이 끊긴다.
#
# 하는 일은 소유자만 1001:1001 로 바꾸는 것이다. 권한 비트(0600 등)는 그대로 둔다
# — chown 은 모드를 건드리지 않는다. 심볼릭 링크는 따라가지 않는다(-h).
#
# 여러 번 돌려도 같다. 컨테이너가 떠 있어도 돌릴 수 있지만, 옛(root) 에이전트가
# 그 뒤에 새 파일을 만들면 다시 root 소유가 된다. 그래서 순서는
#   docker-compose stop bentoagent bentoconnector
#   bash .../migrate-nonroot.sh
#   docker-compose up -d bentoagent bentoconnector
# 이고, 혹시 순서를 어겼으면 새 컨테이너가 뜬 뒤 한 번 더 돌리면 된다.
#
# **compose 서비스로 돌리지 않는다.** 서비스에는 cap_drop: [ALL] 과 read_only 가
# 걸려 있어 --user 0 으로도 chown 을 못 한다. 대신 이미 있는 에이전트(없으면
# 메일함) 이미지를 docker run 으로 따로 띄우고, 고칠 폴더만 물린다.
#
# sudo 는 필요 없다 — docker 그룹이면 된다.
set -uo pipefail

STACK="${1:-${BENTO_DIR:-$PWD}}"
cd "$STACK" || { echo "스택 폴더로 갈 수 없습니다: $STACK" >&2; exit 1; }
if [ ! -f docker-compose.yml ] || [ ! -d data ]; then
  echo "여기($PWD)는 스택 폴더가 아닙니다 — docker-compose.yml 과 data/ 가 있는 곳에서 돌리세요." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE="docker-compose"
fi

# 쓸 이미지. 새로 받지 않도록 이 스택이 이미 빌드한 것을 고른다.
IMG="${MIGRATE_IMAGE:-}"
if [ -z "$IMG" ]; then
  for svc in bentoagent mailbento; do
    cand="$($COMPOSE config --images "$svc" 2>/dev/null | grep -- "-$svc\$" | head -n1)"
    if [ -n "$cand" ] && docker image inspect "$cand" >/dev/null 2>&1; then
      IMG="$cand"
      break
    fi
  done
fi
if [ -z "$IMG" ]; then
  echo "쓸 이미지를 찾지 못했습니다. 먼저 docker-compose build 를 하거나 MIGRATE_IMAGE=<이미지> 로 주세요." >&2
  exit 1
fi

# 없는 폴더는 만들어 둔다 — 처음 켜는 커넥터처럼 아직 없으면 도커가 root 소유로
# 만들어 버린다. (uutils 의 mkdir -p 는 이미 있으면 1 로 끝나므로 || true.)
for d in bentoagent claude-home bentoconnector; do
  mkdir -p "data/$d" 2>/dev/null || true
done

echo "── 소유 바꾸기: data/bentoagent data/claude-home data/bentoconnector → 1001:1001 ($IMG)"
docker run --rm --user 0 --network none --entrypoint sh \
  -v "$PWD/data/bentoagent:/m/bentoagent" \
  -v "$PWD/data/claude-home:/m/claude-home" \
  -v "$PWD/data/bentoconnector:/m/bentoconnector" \
  "$IMG" -c '
    before=$(find /m/bentoagent /m/claude-home /m/bentoconnector \( ! -uid 1001 -o ! -gid 1001 \) | wc -l)
    chown -hR 1001:1001 /m/bentoagent /m/claude-home /m/bentoconnector || exit 1
    after=$(find /m/bentoagent /m/claude-home /m/bentoconnector \( ! -uid 1001 -o ! -gid 1001 \) | wc -l)
    echo "  1001 이 아니던 항목: $before → $after"
    [ "$after" -eq 0 ]
  '
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "소유를 다 바꾸지 못했습니다 (rc=$rc). 위 메시지를 보세요." >&2
  exit "$rc"
fi
echo "끝. 이제 docker-compose up -d bentoagent bentoconnector"
