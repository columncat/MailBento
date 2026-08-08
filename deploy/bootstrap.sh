#!/usr/bin/env bash
# 세 저장소를 받아 스택을 띄운다. 이미 있으면 최신으로 당긴다.
#
# 처음 한 번:
#   ./bootstrap.sh
#   브라우저로 http://<주소>:3000 → 설치 마법사
#
# 나중에 갱신할 때도 같은 명령이다. 설정과 데이터는 ./config, ./data 에
# 있으므로 다시 빌드해도 남는다.
set -euo pipefail

cd "$(dirname "$0")"

OWNER="${BENTO_GITHUB_OWNER:-columncat}"
REF="${BENTO_REF:-main}"
REPOS="MailBento MemoBento BentoAgent"

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

echo "── 빌드"
$COMPOSE build

echo "── 시작"
$COMPOSE up -d

echo
if [ -f config/setup.json ]; then
  echo "이미 설정돼 있습니다. 그대로 올라옵니다."
else
  port="${MAILBENTO_PORT:-3000}"
  echo "설치 마법사가 열려 있습니다 — 브라우저로 http://<이 기계 주소>:${port} 를 여세요."
fi
