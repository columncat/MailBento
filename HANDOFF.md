# MailBento — 인수인계

코드를 처음 여는 사람이 **왜 이렇게 되어 있는지**를 먼저 알 수 있게 쓴 문서다.
무엇을 하는지는 코드가 말해 준다. 여기에는 코드만 봐서는 알 수 없는 결정과 함정을 적는다.

---

## 1. 한 줄 요약

여러 IMAP 메일함을 한 화면에 늘어놓고, 옆에 시계·검색·번역·폴더·메모·코크보드
위젯을 붙인 개인 대시보드. Synology NAS 의 Docker 로 돌고, 자매 앱 **MemoBento** 와
일부 데이터를 공유한다.

---

## 2. 지형도

```
src/
  app/
    api/
      mail/                 메일 목록·단일 메일 (캐시 + 표식 병합)
      archive/              메일 보관함 (사본)
      accounts/ config/ widget/ export/ import/
    settings/               계정·위젯·백업
  components/
    dashboard.tsx           레이아웃의 중심. 위젯 ON/OFF, 넓은 화면 2×2 그리드
    inbox-card.tsx          메일함 카드 (머리말 = 순서 손잡이)
    message-modal.tsx       메일 열람 (라이브 / 보관본 양쪽)
    widget-side-wing.tsx    보관함(왼쪽 열 전체) · Memo · Corkboard 배치
    widget-archive.tsx      메일 보관함 위젯
    widget-*.tsx            시계 / 검색 / 번역 / 폴더
  lib/
    providers/imap.ts       IMAP 구현 (imapflow + mailparser)
    mail-cache.ts           stale-while-revalidate 캐시
    message-flags.ts        앱 내부 읽음/표식
    archive-server.ts       보관 사본 저장·조회·순서
    message-detail-cache.ts 방금 연 본문의 짧은 기억
    widget-server.ts        widget_state JSON
    crypto.ts               계정 비밀번호 암복호화
```

---

## 3. 반드시 알고 있어야 하는 것

### 3.1 `accounts` 는 "계정"이 아니라 "뷰"다

같은 자격증명으로 행을 복제해 `query` 만 다르게 주면 같은 메일함의 다른 뷰가 된다
(`/api/accounts/[id]/duplicate`). 그래서 계정 행이 늘어나는 것은 정상이고,
계정 삭제가 곧 "메일함 삭제"를 뜻하지 않는다.

### 3.2 보관함은 **참조가 아니라 사본**이다

IMAP UID 는 메일이 지워지거나 UIDVALIDITY 가 바뀌면 더 이상 같은 메일을 가리키지
않는다. 그래서 `archived_messages` 에 본문 HTML·텍스트·수신인까지 통째로 뜬다.
원본이 서버에서 사라져도 그대로 열린다 — 이게 이 기능의 존재 이유다.

**계정 FK 는 `onDelete: set null` 이다. cascade 로 바꾸면 안 된다.**
`/api/import` 가 백업 복원 시 `db.delete(schema.accounts).run()` 로 전 계정을 지우는데
(`foreign_keys = ON`), cascade 였다면 **백업 불러오기 = 보관함 전멸**이 된다.
계정이 사라지면 `sourceAccountId` 만 null 이 되고 사본과 출처 이름은 남는다.
목록에는 "(원본 없음)" 으로 표시한다.

표식(읽음/마크)도 보관 시점에 복사해 사본 자신의 컬럼에 둔다. `message_flags` 는
계정과 함께 cascade 로 사라지므로 계속 기댈 수 없다.

### 3.3 보관 본문은 클라이언트에서 받지 않는다

목록 행에는 본문이 없고, 무엇보다 클라이언트가 보낸 HTML 을 그대로 저장하면
`sanitize` 를 우회하는 길이 열린다. 방금 열어 본 것이면 `message-detail-cache` 에서,
아니면 IMAP 에서 다시 받아 온다.

본문은 SQLite TEXT 에 넣되 html 2MB / text 500KB 로 자른다. 넘치면 `data:` 로
박아 넣은 인라인 이미지부터 버린다. (파일 저장소를 새로 만들면 경로 설정·생성·
경로탈출 검사·고아 파일 정리가 통째로 딸려온다.)

**첨부와 `cid:` 인라인 이미지는 보관하지 않는다.** `MailMessageDetail` 에 첨부 필드가
없고 IMAP 구현도 읽지 않는다. 라이브 열람에서도 `cid:` 는 이미 깨져 있어 회귀는 아니다.

### 3.4 보관본 열람은 라이브 경로를 타면 안 된다

`/api/mail/[accountId]/[messageId]` 는 (a) 계정이 없으면 404, (b) IMAP 재조회,
(c) 열람과 동시에 읽음 표시 — 셋 다 사본에 맞지 않는다. 그래서 `/api/archive/[id]` 를
따로 둔다. 응답은 `MailMessageDetail` 과 **같은 모양**으로 맞춰 내려보낸다
(`toMailDetail`) — 모달이 두 모양을 알 필요가 없게.

### 3.5 캐시는 만료돼도 버리지 않는다

`mail-cache` 는 stale-while-revalidate 다. 만료된 값을 지우지 않고 그대로 보여준 뒤
뒤에서 갱신한다. IMAP 이 느리거나 죽어도 화면이 비지 않는다.
`mergeKeepingLastGood` 은 일부 계정만 실패했을 때 나머지 좋은 값을 지키는 장치다.

표식은 DB 라서 **캐시를 무효화하지 않고도** 즉시 반영된다(`withFlags`).
보관 여부도 같은 자리에서 얹는다.

### 3.6 순서 손잡이는 머리말이다

예전에는 dnd-kit 리스너와 `touch-action:none` 이 카드 전체에 걸려 있어 본문 글자를
고를 수도, 목록을 터치로 굴릴 수도 없었다. 지금은 `<header>` 에만 붙고, 안쪽 버튼·
링크 묶음은 `pointerdown` 을 막는다.

`role` / `tabIndex` 는 넘기지 않는다 — 버튼과 링크를 품은 머리말에 `role="button"` 을
씌우면 그 안의 것들이 보조기술에서 묻힌다.

### 3.7 메일 줄의 아이콘단은 흐름 밖에 있다

표식과 보관을 세로로 쌓으면 두 아이콘(24+24+간격)이 글자보다 키가 커서 줄 높이를
끌어올린다. 그래서 오른쪽에 띄워 두고, 예전에 표식 하나가 흐름 안에서 차지하던
폭(56px)을 그대로 비워 글자 자리가 달라지지 않게 했다.
`group/row` 는 **`<li>` 에 있어야 한다** — 아이콘단이 안쪽 div 의 형제라서,
안쪽에 두면 hover 가 걸리지 않는다.

### 3.8 시계 지역은 저장 값과 파생 값을 나눈다

`app_config.regions` 에 들어가는 것은 **이름 · 배지 · 위경도 · 표준시 · 단위 · 로케일**
뿐이다. 좌표 표기·표준시 라벨·날씨 조회 키는 `toRegion` 이 그릴 때 만든다. 손으로 적게
두면 위경도를 옮겼을 때 표기만 옛 값으로 남고, 서머타임이 바뀌어도 라벨이 안 따라온다.

`DEFAULT_REGIONS` 는 예전에 하드코딩돼 있던 두 곳(서울·West Lafayette) 그대로다.
**한 곳으로 줄이면 이미 쓰던 사람의 두 번째 시계가 업데이트만으로 말없이 사라진다.**

`normalizeRegions` 는 깨진 항목만 버리고 나머지는 살린다 — 하나 틀렸다고 전체를
기본값으로 되돌리면 다른 지역 설정까지 함께 날아간다.

예전 `widget-config.ts` 에는 `mapImage` / `markerX` / `markerY` 필드가 있었는데
**어디서도 그리지 않는 죽은 코드**였다. 지도를 갈아 끼워야 할 것처럼 보이지만 아니다.

### 3.9 route handler 의 리다이렉트는 상대 경로로 준다

`NextResponse.redirect(new URL("/login", req.url))` 은 **쓰지 않는다**.
standalone 빌드의 route handler 에서 `req.url` 의 오리진은 요청의 Host 가 아니라
서버가 바인드한 주소로 채워진다. Dockerfile 이 `HOSTNAME=0.0.0.0` 이므로 그대로
절대 URL 을 만들면 `Location: http://0.0.0.0:3000/login` 이 나가고 브라우저가
거기로 끌려간다. Host 헤더를 무엇으로 주든 똑같다.

미들웨어는 증상이 없다 — Next 가 같은 오리진이면 상대 경로로 정규화해 준다.
그래서 **route handler 에서만** 터지고, 그중에서도 세션 만료 후 자동 갱신
(`/api/auth/auto-renew`)과 로그아웃에서만 지나가므로 "가끔" 처럼 보인다.

`lib/redirect.ts` 의 `redirectTo()` 를 쓸 것. Location 은 상대 경로여도 되고
(RFC 9110 §10.2.2) 브라우저가 현재 오리진 기준으로 풀어 주므로 LAN·Tailscale·
리버스 프록시 어디로 들어왔든 따라온다. Host 헤더를 믿고 오리진을 되짜맞추는
방법도 있지만 그건 헤더 위조로 열린 리다이렉트가 되는 길을 새로 여는 셈이다.

### 3.10 마이그레이션은 `when` 이 증가해야만 적용된다

`drizzle/meta/_journal.json` 의 `when` 이 마지막 적용값 이하이면 drizzle 은 **예외 없이
조용히 건너뛴다.** `npm run db:generate` 후 새 항목의 `when` 을 눈으로 확인할 것.
`drizzle/` 는 커밋 대상이다.

### 3.11 Dockerfile 의 `ENCRYPTION_KEY` 는 빌드 단계 더미다

빌드 시점에만 필요해서 넣어 둔 값이고 **런타임 스테이지에는 없다**. 실제 값은
컨테이너 환경변수로 주입한다. 이미지에 시크릿은 들어가지 않는다.

---

## 4. 자주 건드리게 되는 곳

| 하고 싶은 일 | 손댈 곳 |
|---|---|
| 메일 목록에 새 표시 얹기 | `providers/types.ts` 의 `MailMessage` → `api/mail/route.ts` 의 `withFlags` → `inbox-card.tsx` |
| 보관 사본에 컬럼 추가 | `db/schema.ts` → `archive-server.ts`(Summary/Detail/values) → **export/import** |
| 위젯 추가 | `components/widget-*.tsx` → `widget-side-wing.tsx` 또는 `dashboard.tsx` 배치 |
| 시계 지역에 항목 추가 | `lib/regions.ts` 의 `RegionInput` → `normalizeRegions` → `settings/regions-setting.tsx` 입력칸. 파생 값이면 `toRegion` 에만 |
| 화면 색·글꼴 | `app/globals.css`. 인라인 style 로만 쓰는 변수는 `:root` 에 둘 것 |

---

### 3.12 `/api/login` 은 사람이 아닌 클라이언트용이다

화면 로그인은 서버 액션이라 폼 인코딩과 액션 ID 를 알아야 부를 수 있다. MCP 서버나
스크립트가 그걸 흉내내게 두면 Next 내부 규약에 묶이므로 JSON 입구를 따로 뒀다.
검사·기록·쿠키는 서버 액션과 같은 것을 쓴다. 폼이 아니라 무차별 대입이 쉬워지는
만큼 실패에 고정 지연을 준다.

---

## 4.5 MCP 서버

`mcp/` 는 앱과 **별개의 npm 패키지**다 (루트 tsconfig 와 .dockerignore 에서 제외).

IMAP 에 직접 붙지 않고 HTTP API 만 쓴다 — 캐시·표식·보관 사본 규칙이 서버 쪽에 있다.
API 응답은 봉투가 라우트마다 다르다(`{message,flag}` / `{archived,list}` / `{list}` /
`{accounts}`). `shape.ts` 에서 벗겨 내고 필요한 것만 남긴다. 메일 본문은 HTML 이면
태그를 벗겨 텍스트로 준다 — 태그가 토큰을 다 먹는다.

---

## 5. 운영

```bash
npm run dev
npm run build && npm start
npm run db:generate
```

배포는 NAS 에서 `docker-compose up -d --build`. 코드 트리를 교체할 때는
`src` / `drizzle` / `public` 을 먼저 지우고 풀어야 한다.

`data/` 는 DB 가 사는 곳이다. **커밋 금지.** 백업은 sqlite `.backup` API 로 —
`cp` 는 WAL 내용을 놓친다.

ESLint 설정이 없어 `npm run lint` 는 대화형 설정 마법사를 띄운다. 지금은 타입체크와
빌드로만 검증한다.

---

## 6. 알려진 문제 / 남아 있는 것

- **`middleware.ts` 의 경계 검사** — `startsWith(p)` 가 경로 경계를 보지 않아
  `/loginX` 같은 것이 공개 취급된다. 지금 실제로 뚫리는 경로는 없지만 규칙 자체가 위험하다.
- **API 401** — 세션이 만료되면 API 요청도 `/login` 으로 302 된다. 클라이언트의
  `res.json()` 이 파싱 오류로 터진다. `/api/*` 는 401 JSON 을 주는 편이 맞다.
- **UIDVALIDITY 무방비** — `message_flags` 의 키가 `(account_id, message_id)` 인데
  UIDVALIDITY 를 저장하지 않는다. 서버가 UID 를 재사용하면 표식이 엉뚱한 메일에 붙는다.
  보관함은 스냅샷이라 오염이 누적되지는 않는다.
- **저장 실패 무통보** — 위젯 저장과 보관함 순서 저장이 `.catch(() => {})` 로 삼킨다.
- **`isWide` 임계 1280px** — 위젯 날개가 752px 로 고정이라 그 근처에서 메일 카드가
  많이 좁아진다.
