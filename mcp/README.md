# mailbento-mcp

[MailBento](../README.md) 의 **메일함·메일·보관함에 에이전트가 접근**할 수 있게 해 주는
MCP 서버입니다. stdio 로 붙습니다.

앱의 HTTP API 만 씁니다. IMAP 에 직접 붙지 않습니다 — 캐시(stale-while-revalidate),
앱 내부 표식, 보관 사본 규칙이 전부 서버 쪽에 있어서 우회하면 그게 다 깨집니다.

## 어디서 돌리나

MailBento 에 HTTP 로 닿을 수 있으면 됩니다.

| 상황 | `MAILBENTO_URL` |
| --- | --- |
| 같은 호스트 (Docker 로 앱을 띄운 머신) | `http://127.0.0.1:3000` |
| 같은 내부망의 다른 머신 | `http://<호스트>:3000` |
| SSH 로만 닿는 경우 | 아래 참고 |

## 설치

```bash
git clone https://github.com/columncat/MailBento.git
cd MailBento/mcp
npm install
npm run build
```

## 설정

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `MAILBENTO_URL` | `http://127.0.0.1:3000` | 앱 주소 |
| `MAILBENTO_PASSWORD` | (없음) | `AUTH_PASSWORD` 를 켠 서버라면 필수 |
| `MAILBENTO_TIMEOUT_MS` | `30000` | 요청 하나의 제한 시간. IMAP 재조회가 느릴 수 있습니다 |

앱에는 API 토큰이 없어서, 사람이 쓰는 것과 같은 비밀번호로 세션 쿠키를 받아 씁니다.
세션이 만료되면 자동으로 다시 로그인하고 원래 요청을 재시도합니다.

### MCP 클라이언트에 등록

```json
{
  "mcpServers": {
    "mailbento": {
      "command": "node",
      "args": ["/path/to/MailBento/mcp/dist/index.js"],
      "env": {
        "MAILBENTO_URL": "http://127.0.0.1:3000",
        "MAILBENTO_PASSWORD": "…"
      }
    }
  }
}
```

Claude Code 라면:

```bash
claude mcp add mailbento --env MAILBENTO_URL=http://127.0.0.1:3000 --env MAILBENTO_PASSWORD=… -- node /path/to/MailBento/mcp/dist/index.js
```

### SSH 너머로 쓰기

stdio 서버라서 원격에서 그대로 실행하면 됩니다. 비밀번호는 명령줄이 아니라 원격의
환경에 두는 편이 안전합니다 (명령줄 인자는 그 호스트의 프로세스 목록에 보입니다).

```json
{
  "command": "ssh",
  "args": ["nas", "MAILBENTO_URL=http://127.0.0.1:3000", "node", "/volume1/docker/MailBento/mcp/dist/index.js"]
}
```

## 도구

### 메일함 · 메일

| 도구 | 하는 일 |
| --- | --- |
| `list_mailboxes` | 등록된 메일함(계정 뷰) 목록 |
| `list_mail` | 최근 메일 목록. `force=true` 면 IMAP 재조회, `unreadOnly`·`limit` 지원 |
| `search_mail` | 제목·보낸사람·미리보기 검색 |
| `read_mail` | 메일 한 통의 본문 |
| `set_mail_flags` | 읽음·표식 (앱 내부에만 적용) |
| `update_mailbox` | 이름·IMAP 쿼리·표시 주소 변경 |
| `reorder_mailboxes` | 화면 배치 순서 |

### 보관함

| 도구 | 하는 일 |
| --- | --- |
| `list_archive` | 보관 사본 목록 |
| `archive_mail` | 메일을 사본째 보관 |
| `read_archived` | 보관 사본의 본문 (IMAP 을 타지 않음) |
| `set_archived_flags` | 사본의 읽음·표식 |
| `unarchive` | 사본 삭제 — **되돌릴 수 없음** |
| `reorder_archive` | 보관함 안 순서 |

메일함은 **id · 이름 · 주소** 중 아무것으로나 지정합니다. 같은 이름이 둘 이상이면
id 를 쓰라고 알려 줍니다.

### 알아 둘 것

- **`read_mail` 은 여는 순간 앱에서 읽음으로 표시합니다.** IMAP 서버의 `\Seen` 은
  건드리지 않습니다.
- **표식(읽음/마크)은 앱 내부 값입니다.** 메일 서버나 다른 메일 클라이언트에는 보이지
  않습니다.
- **본문은 텍스트를 우선 씁니다.** 텍스트가 없으면 HTML 에서 태그를 벗겨 냅니다.
  기본 4000자에서 자르며 `bodyLimit: 0` 으로 전문을 받을 수 있습니다.
- **메일함 하나가 실패해도 나머지는 옵니다.** 그 메일함의 `error` 에 사유가 담깁니다.
- **`archive_mail` 은 사본을 통째로 뜹니다.** 본문·수신인까지 복사하므로 원본이
  서버에서 사라져도 열립니다. 첨부와 인라인(`cid:`) 이미지는 보관하지 않습니다.
- **`unarchive` 는 되돌릴 수 없습니다.** 원본이 이미 IMAP 에서 사라졌을 수 있고,
  그렇다면 그 메일은 어디에도 남지 않습니다.

## 안 되는 것

- **메일 보내기.** MailBento 는 읽기 전용 대시보드입니다. SMTP 를 쓰지 않습니다.
- **메일 삭제·이동.** IMAP 서버의 상태를 바꾸는 동작은 앱에 없습니다.
- **메일함 추가·삭제.** 추가는 IMAP 앱 비밀번호가 필요해서 이 서버가 다루지 않습니다.
  삭제는 앱의 설정 화면에서 하세요. `update_mailbox` 는 표시용 값과 쿼리만 바꿉니다.
- **첨부 파일 내려받기.** 앱 자체가 첨부를 다루지 않습니다.

## 개발

```bash
npm run check   # 타입 검사
npm run build   # dist/ 생성
```
