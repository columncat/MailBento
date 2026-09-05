# Cloudflare 터널에 얹기

한 도메인을 경로로 나눠 쓰는 배포(`bento.example.com/mail` · `/memo` · `/paper` ·
`/voice`)를 터널 뒤에 두는 방법.

## 앱 쪽

경로를 나눠 쓰려면 앱이 자기가 어디에 얹혀 있는지 알아야 한다. 스택 폴더의
`.env` 에 적고 다시 빌드한다 — **빌드 시점에 박히는 값이다.**

```sh
MAILBENTO_BASE_PATH=/mail
MEMOBENTO_BASE_PATH=/memo
PAPERBENTO_BASE_PATH=/paper
VOICEBENTO_BASE_PATH=/voice
```

```sh
./bootstrap.sh
```

그리고 앱끼리 오가는 버튼 주소를 설정에 적는다. 비워 두면 접속한 호스트의
3000·3001·3002·3003 포트로 유추하는데, 한 도메인을 나눠 쓰면 그 유추가 맞지 않는다.

```
# config/mailbento.env
MEMOBENTO_URL='https://bento.example.com/memo'
PAPERBENTO_URL='https://bento.example.com/paper'
VOICEBENTO_URL='https://bento.example.com/voice'

# config/memobento.env
MAILBENTO_URL='https://bento.example.com/mail'
PAPERBENTO_URL='https://bento.example.com/paper'
VOICEBENTO_URL='https://bento.example.com/voice'

# config/paperbento.env
MAILBENTO_URL='https://bento.example.com/mail'
MEMOBENTO_URL='https://bento.example.com/memo'
VOICEBENTO_URL='https://bento.example.com/voice'

# config/voicebento.env
MAILBENTO_URL='https://bento.example.com/mail'
MEMOBENTO_URL='https://bento.example.com/memo'
PAPERBENTO_URL='https://bento.example.com/paper'
```

설치 마법사의 **주소** 칸에 적으면 이 네 파일에 알아서 들어간다.

> 음성함만 주소가 둘이다. `MEMOBENTO_URL` 은 **사람이 누르는 버튼**의 주소이고,
> 파일을 실제로 읽어 오는 주소는 `MEMOBENTO_API_URL`(`http://memobento:3000`)
> 이다. 한 이름에 두 뜻을 담으면, 브라우저용 주소를 적는 순간 서버끼리의 호출이
> 터널을 한 바퀴 돌아 나갔다 들어온다. 마법사가 둘을 따로 적는다.

## 터널 쪽

터널이 **토큰 관리형**이면 설정이 디스크가 아니라 Cloudflare 쪽에 있다.
대시보드에서 넣거나 API 로 넣는다.

규칙은 위에서부터 먼저 맞는 것이 이긴다. 그래서 경로가 붙은 것을 위에,
아무것도 안 걸리는 것을 아래에 둔다.

| 호스트 | 경로 | 서비스 |
| --- | --- | --- |
| `bento.example.com` | `^/mail(/\|$)` | `http://localhost:3000` |
| `bento.example.com` | `^/memo(/\|$)` | `http://localhost:3001` |
| `bento.example.com` | `^/paper(/\|$)` | `http://localhost:3002` |
| `bento.example.com` | `^/voice(/\|$)` | `http://localhost:3003` |
| (그 외) | | `http_status:404` |

### 경로는 글롭이 아니라 정규식이다. 앵커를 빼지 마라

`path` 는 **Go 정규식**이고 문자열 어디에나 걸린다. 글롭처럼 보고 `/mail*`
이라고 적으면 그건 "`/mai` 다음에 `l` 이 0개 이상" 이라는 뜻이 되고, `l` 이
0개여도 되니 결국 **`/mai` 를 품은 모든 경로**가 걸린다.

실제로 그래서 사고가 났다. `/mail*` 규칙이 메모함의
`/memo/_next/static/chunks/main-app.js` 를 가로챘다 — `/main-app.js` 안에
`/mai` 가 있었기 때문이다. 화면은 뜨는데 자바스크립트가 통째로 메일함에서
와서 아무것도 안 눌리는 상태가 됐고, 브라우저 콘솔에는 문법 오류만 찍혀서
원인을 찾는 데 한참 걸렸다.

`^` 로 앞을 묶고 `(/|$)` 로 뒤를 막는다. 그래야 `/paper` 와 `/paper/…` 만
걸리고 `/papers-old` 나 `/x/paper` 는 안 걸린다.

### 무료 플랜은 올리는 본문을 100MB 에서 끊는다

음성함이 여기 걸린다. 한 시간짜리 영상은 대개 100MB 를 넘는데, 한 번에 보내면
Cloudflare 가 앱에 닿기도 전에 413 으로 끊는다. 그래서 음성함과 논문함은 파일을
**조각내 올린다** (`/api/upload/init|chunk|finish`, 조각 8MB). 조각 하나가 한
요청이라 상한에 닿지 않는다.

앱 쪽에서 이미 해 둔 일이라 터널에 손댈 것은 없다. 다만 "큰 파일만 413 이 난다"
는 증상을 보면 조각 내기를 건너뛴 길을 의심하면 된다 — 손으로 만든 curl 이나
에이전트 입구(`/api/agent/inbox`)는 한 번에 보낸다.

**cloudflared 는 경로를 잘라 내지 않는다.** `/mail/settings` 로 들어온 요청은
`/mail/settings` 그대로 앱에 닿는다. 그래서 앱 쪽에 `BASE_PATH` 가 필요하다 —
잘라 주기를 기대하고 설정을 비워 두면 화면은 뜨는데 링크와 자산이 전부 깨진다.

### DNS

`bento.example.com` 을 터널로 향하는 CNAME 으로 둔다. 프록시(주황 구름)를 켠다.

```
bento.example.com  CNAME  <터널ID>.cfargotunnel.com   (proxied)
```

### API 로 넣을 때

토큰에 다음 권한이 있어야 한다.

- `Zone → DNS → Edit` (레코드용)
- `Account → Cloudflare Tunnel → Edit` (ingress 용)

```sh
CF=$(cat ~/.cf_token)
API=https://api.cloudflare.com/client/v4
ACCOUNT=<계정ID>
TUNNEL=<터널ID>

curl -X PUT "$API/accounts/$ACCOUNT/cfd_tunnel/$TUNNEL/configurations" \
  -H "Authorization: Bearer $CF" -H "content-type: application/json" \
  -d '{
    "config": {
      "ingress": [
        { "hostname": "bento.example.com", "path": "^/mail(/|$)",
          "service": "http://localhost:3000" },
        { "hostname": "bento.example.com", "path": "^/memo(/|$)",
          "service": "http://localhost:3001" },
        { "hostname": "bento.example.com", "path": "^/paper(/|$)",
          "service": "http://localhost:3002" },
        { "hostname": "bento.example.com", "path": "^/voice(/|$)",
          "service": "http://localhost:3003" },
        { "service": "http_status:404" }
      ]
    }
  }'
```

**이미 있던 규칙을 함께 실어야 한다.** 이 API 는 통째로 갈아 끼운다 — 빠뜨린
규칙은 사라진다. 먼저 `GET` 으로 지금 것을 받아 거기에 더하는 편이 안전하다.

## 기계를 옮길 때

터널은 나가는 연결로만 이어지므로 공인 IP 도 포트 개방도 필요 없다. 기계를
다른 네트워크로 옮겨도 `cloudflared` 가 다시 붙으면 같은 도메인이 그대로
따라온다. 손댈 것이 없다.

## 확인

```sh
curl -sI https://bento.example.com/mail    # 307 → /mail/login
curl -sI https://bento.example.com/paper   # 307 → /paper/login
curl -sI https://bento.example.com/voice   # 307 → /voice/login
curl -s  https://bento.example.com/mail/api/agent/chat   # 401 JSON (로그인 전)
```

`/mail` 이 404 면 ingress 의 경로 규칙이 안 걸린 것이고, 화면은 뜨는데 모양이
깨졌다면 `BASE_PATH` 없이 빌드된 이미지가 도는 것이다.

앱은 뜨는데 **아무것도 안 눌린다**면 정적 자산이 남의 앱에서 오고 있는 것이다.
개발자 도구의 네트워크 탭에서 `_next/static/…` 이 어디로 갔는지 본다 — 위의
앵커 이야기가 그 사고다.
