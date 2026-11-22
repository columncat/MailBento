# Bento 스택

메일함(MailBento) · 메모함(MemoBento) · 논문함(PaperBento) · 음성함(VoiceBento) ·
장부함(LedgerBento) · 에이전트(BentoAgent) 여섯 컨테이너를 한 스택으로 띄운다.
여섯은 `bento` 네트워크 하나에 들어가고, 서로를 서비스 이름으로 부른다.

## 새 기계에 설치

```sh
mkdir bento && cd bento
curl -O https://raw.githubusercontent.com/columncat/MailBento/main/deploy/bootstrap.sh
curl -O https://raw.githubusercontent.com/columncat/MailBento/main/deploy/docker-compose.yml
chmod +x bootstrap.sh
./bootstrap.sh
```

저장소 여섯을 받아 이미지를 만들고 컨테이너를 띄운다. 첫 빌드는 몇 분 걸린다
(에이전트 이미지가 Claude Code CLI 를 통째로 설치하고, 음성함이 쓸 전사 모델
487MB 를 함께 받는다).

빌드가 끝나면 `./bootstrap.sh` 가 설치 마법사를 띄우고 **기다린다.** 마법사는
이 기계의 **`127.0.0.1:3000`** 에만 열린다 — 인증 없이 모든 비밀(Claude 토큰,
Discord 토큰, 비밀번호)을 받아 적는 화면이라, 같은 공유기 아래 누구든 먼저
채울 수 있는 자리에 두지 않는다. 다른 기계의 브라우저에서 열려면 ssh 로 포트를
끌어온다:

```sh
ssh -L 3000:127.0.0.1:3000 <계정>@<이 기계 주소>
# 그리고 브라우저로 http://localhost:3000
```

값을 채우고 저장하면 마법사가 스스로 끝나고, `./bootstrap.sh` 가 이어서 여섯
서비스를 띄운다.

### 마법사를 다시 돌리려면

compose 로는 마법사가 뜨지 않는다. 앱들은 `config/` 에서 **제 파일 한 장씩만**
읽기 전용으로 받는데(아래 "설정은 앱마다 제 것만"), 그 파일이 없으면 compose 가
컨테이너를 아예 만들지 않는다. 처음부터 다시 쓰려면 `config/setup.json` 을 다른
이름으로 옮겨 두고 `./bootstrap.sh` 를 다시 돌리거나, 손으로 띄운다:

```sh
docker-compose stop
mv config/setup.json config/setup.json.old   # 있으면 마법사 대신 앱이 뜬다
docker run --rm --init -e BENTO_MANAGED=1 -p 127.0.0.1:3000:3000 \
  -v "$PWD/config:/config" mailbento-mailbento    # 저장하면 스스로 끝난다
docker-compose up -d
```

마법사를 중간에 끊어 `setup.json` 이 없으면 `up` 이 컨테이너를 띄우지 못한다
(일부러 그렇다). 옮겨 둔 `setup.json.old` 를 되돌리면 예전 설정으로 돌아온다.

마법사만은 `./config` 를 **쓰기로 통째로** 물려야 한다 — 여섯 앱의 설정을 모두
거기 적기 때문이다. 이미지 이름은 `docker-compose config --images mailbento` 가 말한다.

### 장부함은 비공개 저장소다

나머지 넷과 달리 `columncat/LedgerBento` 는 비공개라, 이 기계에 GitHub 자격이
있어야 받아진다. 없으면 소스를 `src/LedgerBento` 에 직접 올려 두고 다시 실행한다
(에이전트와 같은 사정이다).

그래서 **에이전트가 쓸 장부함 MCP 도 이미지가 받지 않는다.** 도커에게 자격을
쥐여 주는 대신, `bootstrap.sh` 가 `src/LedgerBento/mcp` 를 컨테이너 하나로
컴파일해 두고 compose 가 그 폴더를 읽기 전용으로 물려 준다. 호스트에 node 가
없어도 된다.

### 전사 모델은 이미지가 아니라 볼륨에 산다

음성함이 쓰는 parakeet 은 받는 것이 487MB, 풀면 671MB 다. 이미지에 구우면
런타임이 562MB 에서 1.7GB 로 불고 앱을 한 줄 고칠 때마다 그 층을 다시 민다.
`./bootstrap.sh` 가 `data/voice-models/` 에 받아 두고, 컨테이너는 거기를
읽기 전용으로 본다. 이미 있으면 다시 받지 않는다.

**화자 분리 모델도 같은 자리에 산다.** 분할(pyannote-segmentation-3.0, MIT ·
Copyright (c) 2022 CNRS) 5,992,913B + 임베딩(3D-Speaker CAM++, Apache-2.0)
28,281,164B = **34.3MB** 가 더해져 `voice-models/` 는 **671MB → 705MB** 다.
받는 바이트는 35.2MB 이고 분할 모델의 묶음은 푼 뒤 지운다. 전사문 DB 쪽은
녹음마다 화자 구간이 한 줄 더 쌓인다 — 99분짜리 회의에서 구간 1,019개가
34KB 였다.

**받지 못해도 스택은 뜬다.** 전사 모델이 없으면 전사만 안 되고, 화자 분리
모델이 없으면 **화자 구분만** 안 된다. 나머지 넷은 멀쩡하다. 받다 실패하면
경고만 찍히므로, 나중에 `./bootstrap.sh` 를 다시 돌리면 이어서 받는다.

### 음성함에만 메모리 상한이 걸려 있다

`docker-compose.yml` 의 `mem_limit: 3g`. **필요량이 아니라 NAS 를 지키는
안전판이다.** 이 컨테이너만 GB 단위 자식 프로세스를 띄운다 — 전사 워커가
봉우리 1.6GB, 화자 분리 워커가 길이에 비례해 최대 2.1GB(180분이 상한이고,
예산을 넘는 길이는 실루엣을 접는다 — 접은 판은 15.7·49.3분 두 점만 재서 180분이면
약 1.4GB 로 **어림**한 값이다). 둘은 한 줄에 서서
겹치지 않는다. 선에 걸려 워커가 죽어도 전사문은 남는다.

### BentoAgent 는 비공개 저장소다

받으려면 이 기계에 GitHub 자격이 있어야 한다. 가장 간단한 길:

```sh
gh auth login        # repo 권한 필요
```

`gh` 가 git 자격 헬퍼를 걸어 주므로 그다음부터는 `./bootstrap.sh` 가 알아서
받는다. ssh 키를 쓴다면 `BENTO_GITHUB_OWNER` 대신 원격 주소를 손보면 된다.

자격을 둘 수 없는 기계라면 소스를 `src/BentoAgent` 에 직접 올려 두고
`./bootstrap.sh` 를 돌린다 — 이미 있으면 그대로 쓴다. 다만 그 경우
`./bootstrap.sh` 로 갱신되지 않으니 올릴 때마다 손으로 바꿔야 한다.

## 마법사가 받는 것

| 칸 | 설명 |
| --- | --- |
| 접속 비밀번호 | 메일함·메모함·논문함·음성함에 같이 쓴다. 비우면 잠그지 않는다 |
| Claude 인증 | OAuth 토큰(구독) 또는 API 키(종량). 하나만 |
| Discord | 봇 토큰·내 ID. 켜고 끌 수 있다 |
| 주소 | 앱끼리 오가는 버튼용. 비우면 접속한 호스트에서 유추 |

암호화 키·세션 키·에이전트 토큰은 마법사가 만들어 넣는다. 사람이 정할 이유가
없는 값이다.

메일 계정은 여기서 받지 않는다. 설치가 끝난 뒤 메일함의 설정에서 IMAP 으로
추가한다.

## 설치 뒤에 바꾸기

메일함 → **설정 → 에이전트** 에서:

- **Claude 인증 갱신** — OAuth 토큰은 만료된다. 새 값을 넣으면 에이전트가
  다시 시작하면서 물어 간다.
- **Discord 켜고 끄기** — 아래 참고.

토큰 값은 어느 방향으로도 화면에 오지 않는다. 들어 있는지와 어떤 종류인지만
보인다. 빈 칸은 늘 "그대로 두라" 는 뜻이다.

## 두 대에 두려면

**같은 봇 토큰으로 두 대가 동시에 붙을 수 없다.** Discord 는 토큰당 게이트웨이
세션 하나만 허용해서, 둘 다 켜면 서로를 끊으며 튕긴다. 메일 수집도 양쪽에서
돌아 같은 메일에 검토 요청이 두 번 간다.

예비 기계에서는 설정에서 **Discord 를 꺼 둔다.** 그래도 앱들과 채팅창은
그대로 쓸 수 있다. 주가 죽으면 예비에서 켜면 된다.

## 어디에 무엇이 사는가

```
bento/
  config/        설정 (마법사가 적는다. 0600, 컨테이너 사용자 소유)
  data/
    mailbento/     메일 DB
    memobento/     메모 DB · 올린 파일 (소리·영상도 여기 산다)
    paperbento/    논문 DB · 올린 PDF · 표지
    voicebento/    전사문 DB (파일은 안 든다 — 메모함의 것을 fileId 로 읽는다)
    voice-models/  전사 모델 (bootstrap.sh 가 받는다, 671MB)
    bentoagent/    세션 · 예약 · 기록
    claude-home/   대화 기록
    bentoconnector/ Claude 웹 커넥터의 클라이언트 · 토큰(해시)
  src/           받아 둔 저장소 (빌드에 쓴다)
```

`config` 와 `data` 만 챙기면 그대로 옮길 수 있다. 다만 **`ENCRYPTION_KEY` 가
같아야 한다** — 메일 계정 비밀번호가 그 키로 잠겨 있어서, 새로 만들면 계정이
열리지 않는다.

## 포트 바꾸기

같은 폴더의 `.env` 에 적는다.

```sh
MAILBENTO_PORT=3000
MEMOBENTO_PORT=3001
PAPERBENTO_PORT=3002
VOICEBENTO_PORT=3003
LEDGERBENTO_PORT=3004
AGENT_PORT=4000
```

**포트는 전부 `127.0.0.1` 에만 열린다** (앱 다섯도, 2026-11-22 부터). 예전에는
앱 다섯이 `0.0.0.0` 에 열려 있어서, 같은 공유기 아래 누구든 터널 앞의 인증
(Cloudflare Access)을 건너뛰고 앱에 바로 닿았다. 앱들은 `bento` 네트워크 안에서
서비스 이름으로 서로를 부르므로 호스트 포트와 무관하고, 터널(cloudflared)은
같은 기계에서 `127.0.0.1` 로 부른다. 집 안의 다른 기계에서 IP:포트로 바로 열던
사람은 이제 터널 주소로 가거나 `ssh -L 3001:127.0.0.1:3001 …` 처럼 끌어온다.

한 도메인을 경로로 나눠 쓸 거라면 포트 대신
[cloudflare-ingress.md](cloudflare-ingress.md) 를 본다. 거기 `BASE_PATH` 는
**빌드 시점 값**이라 `.env` 에 적고 `./bootstrap.sh` 를 다시 돌려야 한다.

## 갱신

```sh
./bootstrap.sh
```

저장소를 당기고 다시 빌드해 띄운다. `config` 와 `data` 는 그대로 남는다.

## 잘 안 될 때

**컨테이너가 되풀이해 다시 뜬다** — 로그를 보면 대개 `/config` 를 읽지
못한다고 나온다. 호스트 폴더 주인이 컨테이너 사용자(uid 1001)와 달라서다.
로그에 적힌 `chown` 명령을 한 번 돌리거나 `./bootstrap.sh` 로 띄우면 된다.

**마법사 대신 로그인 화면이 뜬다** — 이미 설정된 것이다. `config/setup.json`
이 있으면 마법사를 띄우지 않는다. 처음부터 다시 하려면 `config/` 를 비운다.

**새로 더한 앱만 계속 "설정을 기다립니다" 를 찍는다** — 마법사는 이미 끝났고
(`setup.json` 이 있고) 그 앱의 `.env` 만 없는 것이다. 마법사를 다시 돌리는
대신 옆 앱의 것을 베껴 만들어도 된다:

```sh
cp config/memobento.env config/paperbento.env   # 그 뒤 MAILBENTO_DB_PATH 줄만 지운다
docker compose restart paperbento
```

음성함은 두 줄이 더 필요하다. 파일이 메모함에 살아서, 브라우저가 아니라 **서버가**
메모함을 부른다.

```sh
cp config/paperbento.env config/voicebento.env
cat >> config/voicebento.env <<'EOF'
MEMOBENTO_API_URL='http://memobento:3000'
MEMOBENTO_PASSWORD='<접속 비밀번호와 같은 값>'
EOF
docker compose restart voicebento
```

**전사가 안 되고 모델이 없다고 나온다** — `data/voice-models/` 를 본다.
`sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tokens.txt` 와 `silero_vad.onnx` 가
둘 다 있어야 한다. 없으면 `./bootstrap.sh` 를 다시 돌린다 — 받다 끊긴 것은
버리고 다시 받는다.

## 설정은 앱마다 제 것만

각 앱은 `config/<앱>.env` 와 `config/setup.json` **두 파일만, 읽기 전용으로**
받는다. 예전에는 `./config` 를 통째로 물려서, 앱 하나가 뚫리면 나머지 다섯의
비밀(암호화 키, Claude 토큰, Discord 토큰, 비밀번호)까지 다 읽혔다.

예외는 에이전트의 `bentoagent.env` 하나다. 메일함 **설정 → 에이전트** 에서 Claude
토큰이나 Discord 를 바꾸면 에이전트가 이 파일을 제자리에 고쳐 쓰고 다시 뜬다.
그래서 이 파일만 에이전트에게 쓰기로 열려 있다. 커넥터는 같은 파일을 읽기만 한다.

한 파일 마운트는 파일의 inode 를 붙든다. 호스트에서 편집기로 고치면 편집기가
새 파일을 만들어 바꿔치기할 수 있는데, 그러면 해당 컨테이너는 다시 만들기
(`docker-compose up -d --force-recreate <서비스>`) 전까지 옛 내용을 본다.

## 컨테이너를 단단히

모든 서비스에 `no-new-privileges`, `cap_drop: [ALL]`, 프로세스 수 상한
(`pids_limit`), 로그 크기 상한(10MB × 5)이 걸려 있다. 앱들은 원래 uid 1001 로
돌고 진입 스크립트가 chown·su 를 하지 않으므로 잃는 것이 없다.

**에이전트와 커넥터도 uid 1001 로, 읽기 전용 루트 파일시스템 위에서 돈다**
(2026-11-22 전에는 root 였다). 쓸 수 있는 곳은 `data/` 볼륨, `/tmp`(tmpfs),
`/home/agent`(tmpfs — 그 위에 `data/claude-home` 이 `.claude` 로 얹힌다)뿐이다.
에이전트는 남이 쓴 메일·논문을 읽는 모델을 띄우고 `/unlock` 이면 그 모델에게
셸까지 주므로, root 일 이유가 없다. 대신 `/unlock` 의 셸로는 패키지를 깔거나
이미지 안의 파일을 고칠 수 없다.

root 시절에 만든 파일을 넘기는 일은 한 번만 하면 된다:

```sh
docker-compose stop bentoagent bentoconnector
bash src/MailBento/deploy/migrate-nonroot.sh      # data/bentoagent · claude-home · bentoconnector → 1001
docker-compose up -d bentoagent bentoconnector
```

여러 번 돌려도 같고, `./bootstrap.sh` 도 돌 때마다 같은 일을 한다.

**`cap_drop` 은 `docker-compose run` 에도 따라온다.** 그래서
`docker-compose run --rm --no-deps --user 0 --entrypoint sh <서비스> -c 'chown …'`
은 이제 `Operation not permitted` 로 실패한다. 소유를 고칠 때는
`--cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER` 를 붙이거나,
`bootstrap.sh` 처럼 이미지를 `docker run` 으로 따로 띄운다. 설정 파일은 서비스에
읽기 전용으로만 물려 있으니, 고칠 때도 `-v "$PWD/config:/config"` 로 따로 물린다.
