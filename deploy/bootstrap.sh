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
  else
    echo "── $r 받기"
    # BentoAgent 는 비공개다. 이 계정에 접근 권한이 있어야 한다
    # (ssh 키나 gh auth 로 설정된 자격 증명을 그대로 쓴다).
    git clone --depth 1 -b "$REF" "https://github.com/$OWNER/$r.git" "src/$r"
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
