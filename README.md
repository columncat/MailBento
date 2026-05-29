# MailBento

여러 이메일 계정(Gmail × 2, Outlook × 2, Naver Mail × 2)을 한 페이지에서 동시에 보는 개인용 대시보드.

## 구조

- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind CSS v4
- **Backend**: Next.js Route Handlers + Server Actions
- **DB**: SQLite + Drizzle ORM (`./data/mailbento.db`)
- **Provider 어댑터**
  - Gmail: Google OAuth 2.0 + Gmail API
  - Outlook: Microsoft OAuth 2.0 + Microsoft Graph
  - Naver: IMAP + 앱 비밀번호 (`imapflow`)
- **암호화**: AES-256-GCM (Node `crypto`) — refresh token / IMAP 앱 비밀번호 at rest
- **배포**: Docker (Next.js standalone output) → Synology Container Manager
- **접근**: Tailscale (인터넷 노출 없음)

## 개발 시작

```bash
npm install
cp .env.example .env.local
# .env.local 에 OAuth 자격증명 / ENCRYPTION_KEY 채우기
npm run db:migrate
npm run dev
```

## 환경변수

`.env.example` 참고. 핵심:

- `ENCRYPTION_KEY` — 32바이트 base64 (`openssl rand -base64 32`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`
- `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_REDIRECT_URI`
- `DATABASE_PATH` (기본 `./data/mailbento.db`)

## OAuth 앱 등록 (개발자 콘솔)

- **Google Cloud Console** → APIs & Services → Credentials → OAuth 2.0 Client ID (Web)
  - 스코프: `https://www.googleapis.com/auth/gmail.readonly`
  - Redirect URI: `http://localhost:3000/api/auth/google/callback`
- **Microsoft Entra (Azure Portal)** → App registrations → New registration
  - 스코프: `Mail.Read`, `offline_access`, `User.Read`
  - Redirect URI: `http://localhost:3000/api/auth/microsoft/callback`
- **Naver Mail** → 환경설정 → POP3/IMAP 사용 + 앱 비밀번호 발급

## Docker 배포

```bash
cp .env.example .env.local   # 값 채우기 (ENCRYPTION_KEY 등)
docker compose up -d --build
```

- 첫 부팅 시 **마이그레이션이 자동 적용**되어 빈 DB에서도 테이블이 생성됩니다.
- SQLite DB는 `./data` 볼륨에 영속화됩니다 → 이미지를 새로 빌드/재배포해도
  **계정·폴더·코크보드·메모가 유지**됩니다.
- 시크릿은 이미지에 포함되지 않고 `.env.local`(env_file)로 런타임 주입됩니다.

### 데이터/시크릿 주의

- `ENCRYPTION_KEY`를 바꾸면 저장된 OAuth 토큰을 복호화할 수 없습니다 — DB를 옮길 때
  반드시 동일한 키를 사용하세요.
- 다른 주소(NAS/Tailscale)에서 **새 계정을 추가/재인증**하려면
  `GOOGLE_REDIRECT_URI` 등 redirect URI를 그 주소로 바꾸고 각 OAuth 콘솔에도 등록해야 합니다.
  (이미 발급된 토큰으로 메일을 읽는 것은 redirect URI와 무관합니다.)

## 위젯 설정 백업 (내보내기/불러오기)

폴더·코크보드·메모는 서버(SQLite)에 저장되어 **새 세션/기기에서도 동일하게** 보입니다.
계정 관리 페이지(`/settings`)의 **위젯 설정 백업**에서 JSON으로 내보내고 불러올 수 있어,
다른 서버로 이전하거나 백업할 때 사용합니다.

## Synology NAS 메모

- Container Manager에서 이 저장소를 clone 후 `docker compose up -d --build`,
  또는 로컬에서 빌드한 이미지를 NAS로 옮겨 실행.
- 외부 노출 없이 **Tailscale**로만 접근. 접근 주소(예: `https://mailbento.<tailnet>.ts.net`)에
  맞춰 redirect URI / 포트를 설정하세요.
