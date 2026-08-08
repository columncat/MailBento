# Bento 스택

메일함(MailBento) · 메모함(MemoBento) · 에이전트(BentoAgent) 세 컨테이너를
한 스택으로 띄운다. 셋은 `bento` 네트워크 하나에 들어가고, 서로를 서비스
이름으로 부른다.

## 새 기계에 설치

```sh
mkdir bento && cd bento
curl -O https://raw.githubusercontent.com/columncat/MailBento/main/deploy/bootstrap.sh
curl -O https://raw.githubusercontent.com/columncat/MailBento/main/deploy/docker-compose.yml
chmod +x bootstrap.sh
./bootstrap.sh
```

저장소 셋을 받아 이미지를 만들고 컨테이너를 띄운다. 첫 빌드는 몇 분 걸린다
(에이전트 이미지가 Claude Code CLI 를 통째로 설치한다).

끝나면 브라우저로 **`http://<이 기계 주소>:3000`** 을 연다. 설치 마법사가
떠 있다. 값을 채우고 저장하면 세 서비스가 차례로 올라온다.

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
| 접속 비밀번호 | 메일함·메모함에 같이 쓴다. 비우면 잠그지 않는다 |
| Claude 인증 | OAuth 토큰(구독) 또는 API 키(종량). 하나만 |
| Discord | 봇 토큰·내 ID. 켜고 끌 수 있다 |
| 주소 | 두 앱을 오가는 버튼용. 비우면 접속한 호스트에서 유추 |

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

예비 기계에서는 설정에서 **Discord 를 꺼 둔다.** 그래도 두 앱과 채팅창은
그대로 쓸 수 있다. 주가 죽으면 예비에서 켜면 된다.

## 어디에 무엇이 사는가

```
bento/
  config/        설정 (마법사가 적는다. 0600, 컨테이너 사용자 소유)
  data/
    mailbento/   메일 DB
    memobento/   메모 DB · 올린 파일
    bentoagent/  세션 · 예약 · 기록
    claude-home/ 대화 기록
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
AGENT_PORT=4000
```

에이전트 포트는 `127.0.0.1` 에만 열린다. 두 앱은 네트워크 안에서 서비스
이름으로 부르므로 이 포트가 없어도 채팅창은 돈다.

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
