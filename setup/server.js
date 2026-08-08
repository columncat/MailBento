#!/usr/bin/env node
/**
 * 설치 마법사.
 *
 * 아무것도 설정되지 않은 새 기계에서 처음 뜨는 화면이다. 세 컨테이너(메일함·
 * 메모함·에이전트)가 필요한 값을 여기서 한 번에 받아 `/config` 에 적는다.
 *
 * 왜 앱이 아니라 따로 도는 작은 서버인가 — 메일함 앱은 암호화 키가 없으면
 * 아예 뜨지 못한다. 설정이 없을 때 앱을 억지로 띄우려면 그 검사부터 헐겁게
 * 만들어야 하는데, 평생 한 번 쓰는 화면 때문에 늘 도는 코드를 무르게 할
 * 이유가 없다. 그래서 진입 스크립트가 갈라 준다 — 설정이 없으면 이 서버,
 * 있으면 앱.
 *
 * 다 적고 나면 이 프로세스는 스스로 끝난다. 도커가 다시 띄우고, 그때는
 * 설정이 있으므로 앱이 뜬다. 나머지 두 컨테이너는 설정 파일이 생기기를
 * 기다리다가 그대로 이어서 시작한다.
 *
 * 의존성이 없다. 이 서버가 도는 시점에는 앱의 node_modules 를 믿을 이유가
 * 없고(설치가 반쯤 되다 말았을 수도 있다), 하는 일은 폼 하나 받는 것뿐이다.
 */

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_DIR = process.env.BENTO_CONFIG_DIR || "/config";
const PORT = Number(process.env.PORT || 3000);

/** 32바이트 base64 — 암호화 키와 세션 키에 쓴다. */
const key32 = () => randomBytes(32).toString("base64");
/** 눈으로 옮겨 적을 일이 없는 토큰. */
const token = () => randomBytes(24).toString("base64url");

/**
 * 셸이 `.` 으로 읽어 갈 파일이라 값을 작은따옴표로 감싼다.
 *
 * 비밀번호에 `$`, 백틱, 공백이 섞이는 것은 흔한 일이다. 감싸지 않으면 셸이
 * 그걸 해석해 버려서, 사용자가 넣은 것과 앱이 받는 것이 달라진다.
 */
function envFile(vars) {
  return (
    Object.entries(vars)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}='${String(v).replace(/'/g, "'\\''")}'`)
      .join("\n") + "\n"
  );
}

const HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bento 설치</title>
<style>
  :root {
    --bg: #0f1115; --surface: #171a21; --surface2: #1e222b;
    --fg: #e6e8ee; --fg2: #b6bcc9; --fg4: #7c8496;
    --accent: #7aa2f7; --accent-soft: #7aa2f722; --border: #2a2f3a;
    --danger: #f7768e; --ok: #9ece6a;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f7f9; --surface: #fff; --surface2: #f0f2f5;
      --fg: #1a1d23; --fg2: #454b57; --fg4: #7c8496;
      --accent: #3b6fd4; --accent-soft: #3b6fd41a; --border: #dfe3e9;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.6 system-ui, -apple-system, "Segoe UI", "Noto Sans KR", sans-serif;
    padding: 32px 16px 80px;
  }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .lede { color: var(--fg4); margin: 0 0 28px; font-size: 14px; }
  section {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px 22px; margin-bottom: 16px;
  }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .hint { color: var(--fg4); font-size: 13px; margin: 0 0 16px; }
  label { display: block; margin: 14px 0 5px; font-size: 13px; color: var(--fg2); }
  input[type=text], input[type=password], input[type=number] {
    width: 100%; padding: 9px 11px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--surface2);
    color: var(--fg); font: inherit; font-size: 14px;
  }
  input:focus { outline: none; border-color: var(--accent); }
  .row { display: flex; gap: 12px; }
  .row > div { flex: 1; }
  .check { display: flex; gap: 9px; align-items: flex-start; margin-top: 14px; }
  .check input { margin-top: 4px; }
  .check span { font-size: 13px; color: var(--fg2); }
  .note { font-size: 12px; color: var(--fg4); margin-top: 5px; }
  button {
    width: 100%; padding: 12px; border: 0; border-radius: 10px;
    background: var(--accent); color: #fff; font: inherit; font-weight: 600;
    cursor: pointer; margin-top: 8px;
  }
  button:disabled { opacity: .5; cursor: default; }
  .err {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger); border-radius: 8px; padding: 10px 12px;
    font-size: 13px; margin-bottom: 14px; display: none;
  }
  .done { text-align: center; padding: 48px 0; display: none; }
  .done h2 { font-size: 18px; margin-bottom: 10px; }
  code { background: var(--surface2); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Bento 설치</h1>
  <p class="lede">메일함·메모함·에이전트가 쓸 값을 한 번에 받습니다. 암호화 키처럼 직접 정할 이유가 없는 것은 여기서 만들어 넣습니다.</p>

  <div class="err" id="err"></div>

  <form id="f">
    <section>
      <h2>접속 비밀번호</h2>
      <p class="hint">메일함과 메모함에 같이 씁니다. 비우면 <b>누구나 열 수 있는 상태</b>가 됩니다 — 집 안에서만 쓰고 밖으로 열지 않을 때만 비우세요.</p>
      <label>비밀번호</label>
      <input type="password" name="password" autocomplete="new-password" placeholder="비워 두면 잠그지 않습니다">
      <label>한 번 더</label>
      <input type="password" name="password2" autocomplete="new-password">
    </section>

    <section>
      <h2>Claude</h2>
      <p class="hint">에이전트가 쓰는 인증입니다. 둘 중 하나만 채우세요. 구독으로 쓴다면 컴퓨터에서 <code>claude setup-token</code> 을 돌려 나온 값을 붙입니다.</p>
      <label>OAuth 토큰 <span class="note">(구독)</span></label>
      <input type="password" name="claudeOauth" autocomplete="off" placeholder="sk-ant-oat...">
      <label>또는 API 키 <span class="note">(종량 과금)</span></label>
      <input type="password" name="anthropicKey" autocomplete="off" placeholder="sk-ant-api...">
      <label>모델 <span class="note">(비우면 기본값)</span></label>
      <input type="text" name="claudeModel" placeholder="예: opus / sonnet">
    </section>

    <section>
      <h2>Discord</h2>
      <p class="hint">에이전트에게 말을 걸고 새 메일 알림을 받는 통로입니다. 안 켜도 두 앱의 채팅창은 그대로 쓸 수 있습니다.</p>
      <div class="check">
        <input type="checkbox" name="discordEnabled" id="de" checked>
        <span><b>Discord 봇을 켭니다</b><br>
          <span class="note">끄면 봇이 접속하지 않고 새 메일 검토 요청도 보내지 않습니다. 같은 봇 토큰을 두 대에서 동시에 쓰면 서로를 끊으므로, 예비 기계에서는 꺼 두세요. 나중에 설정에서 바꿀 수 있습니다.</span>
        </span>
      </div>
      <label>봇 토큰</label>
      <input type="password" name="discordToken" autocomplete="off" placeholder="개발자 포털 → Bot → Reset Token">
      <p class="note">MESSAGE CONTENT INTENT 를 켜야 합니다. 봇과 같은 서버에 들어가 있어야 DM 이 열립니다.</p>
      <label>내 사용자 ID</label>
      <input type="text" name="discordOwner" placeholder="개발자 모드 → 이름 우클릭 → ID 복사">
      <label>받을 서버 채널 ID <span class="note">(선택, 쉼표로 여러 개. 비우면 DM 만)</span></label>
      <input type="text" name="discordChannels" placeholder="">
    </section>

    <section>
      <h2>주소</h2>
      <p class="hint">두 앱을 오가는 버튼과 브라우저가 쓰는 주소입니다. 비우면 지금 접속한 호스트에서 알아서 유추하므로, 대개 비워 두면 됩니다.</p>
      <div class="row">
        <div>
          <label>메일함 주소</label>
          <input type="text" name="mailbentoUrl" placeholder="예: https://mail.example.com">
        </div>
        <div>
          <label>메모함 주소</label>
          <input type="text" name="memobentoUrl" placeholder="예: https://memo.example.com">
        </div>
      </div>
      <label>업로드 한 개 최대 크기 (MB)</label>
      <input type="number" name="maxUploadMb" value="5120" min="1">
    </section>

    <button type="submit" id="go">설치하고 시작하기</button>
  </form>

  <div class="done" id="done">
    <h2>설정을 저장했습니다</h2>
    <p class="lede">세 서비스가 차례로 올라옵니다. 10초쯤 뒤 이 페이지가 알아서 메일함으로 넘어갑니다.</p>
  </div>
</main>

<script>
const f = document.getElementById('f');
const err = document.getElementById('err');
const go = document.getElementById('go');

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.style.display = 'none';
  const data = Object.fromEntries(new FormData(f).entries());
  data.discordEnabled = f.discordEnabled.checked;

  if (data.password !== data.password2) {
    err.textContent = '비밀번호 두 칸이 다릅니다.';
    err.style.display = 'block';
    return;
  }
  go.disabled = true;
  go.textContent = '저장하는 중…';
  try {
    const res = await fetch('/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || ('실패 (' + res.status + ')'));
    f.style.display = 'none';
    document.getElementById('done').style.display = 'block';
    // 앱이 뜰 때까지 기다렸다가 넘어간다.
    const tick = setInterval(async () => {
      try {
        const r = await fetch('/', { cache: 'no-store' });
        const t = await r.text();
        if (!t.includes('Bento 설치')) { clearInterval(tick); location.reload(); }
      } catch (_) { /* 아직 다시 뜨는 중 */ }
    }, 2000);
  } catch (e2) {
    err.textContent = e2.message;
    err.style.display = 'block';
    go.disabled = false;
    go.textContent = '설치하고 시작하기';
  }
});
</script>
</body>
</html>`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > 256 * 1024) {
        reject(new Error("본문이 너무 큽니다"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

function save(input) {
  const pick = (v) => (typeof v === "string" ? v.trim() : "");
  const password = pick(input.password);
  const claudeOauth = pick(input.claudeOauth);
  const anthropicKey = pick(input.anthropicKey);
  const discordEnabled = input.discordEnabled === true || input.discordEnabled === "true";
  const discordToken = pick(input.discordToken);
  const discordOwner = pick(input.discordOwner);

  if (claudeOauth && anthropicKey) {
    throw new Error("Claude 인증은 하나만 채우세요. 둘을 함께 주면 CLI 가 API 키를 고릅니다.");
  }
  if (discordEnabled && !(discordToken && discordOwner)) {
    throw new Error("Discord 를 켜려면 봇 토큰과 내 사용자 ID 가 모두 필요합니다.");
  }

  mkdirSync(CONFIG_DIR, { recursive: true });

  // 앱 사이에서만 쓰는 값들 — 사람이 정할 이유가 없다.
  const authSecret = key32();
  const encryptionKey = key32();
  const agentToken = token();

  // 컨테이너끼리는 서비스 이름으로 부른다. 호스트 포트가 바뀌어도 안 흔들린다.
  const AGENT_URL = "http://bentoagent:4000";

  const shared = {
    AUTH_PASSWORD: password,
    AUTH_SECRET: password ? authSecret : "",
    AGENT_URL,
    AGENT_TOKEN: agentToken,
  };

  writeFileSync(
    join(CONFIG_DIR, "mailbento.env"),
    envFile({
      ...shared,
      ENCRYPTION_KEY: encryptionKey,
      MEMOBENTO_URL: pick(input.memobentoUrl),
    }),
    { mode: 0o600 },
  );

  writeFileSync(
    join(CONFIG_DIR, "memobento.env"),
    envFile({
      ...shared,
      MAILBENTO_URL: pick(input.mailbentoUrl),
      MAX_UPLOAD_MB: pick(input.maxUploadMb) || "5120",
    }),
    { mode: 0o600 },
  );

  writeFileSync(
    join(CONFIG_DIR, "bentoagent.env"),
    envFile({
      AGENT_TOKEN: agentToken,
      AGENT_PORT: "4000",
      AGENT_DISCORD_ENABLED: discordEnabled ? "true" : "false",
      DISCORD_TOKEN: discordToken,
      DISCORD_OWNER_ID: discordOwner,
      DISCORD_ALLOWED_CHANNELS: pick(input.discordChannels),
      CLAUDE_CODE_OAUTH_TOKEN: claudeOauth,
      ANTHROPIC_API_KEY: anthropicKey,
      CLAUDE_MODEL: pick(input.claudeModel),
      // 에이전트도 서비스 이름으로 부른다. 앱 비밀번호는 사람 것과 같다 —
      // MCP 가 사람과 같은 입구로 로그인하기 때문이다.
      MEMOBENTO_URL: "http://memobento:3000",
      MEMOBENTO_PASSWORD: password,
      MAILBENTO_URL: "http://mailbento:3000",
      MAILBENTO_PASSWORD: password,
    }),
    { mode: 0o600 },
  );

  // 마지막에 적는다. 이 파일이 있으면 설치가 끝난 것이다 — 중간에 죽어도
  // 반쯤 적힌 설정으로 앱이 뜨지 않는다.
  writeFileSync(
    join(CONFIG_DIR, "setup.json"),
    JSON.stringify({ at: new Date().toISOString(), version: 1 }, null, 1),
    { mode: 0o600 },
  );
}

const server = createServer(async (req, res) => {
  const send = (code, body, type = "application/json; charset=utf-8") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };

  if (req.method === "GET") {
    send(200, HTML, "text/html; charset=utf-8");
    return;
  }

  if (req.method === "POST" && req.url === "/save") {
    try {
      save(JSON.parse(await readBody(req)));
    } catch (e) {
      send(400, JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      return;
    }
    send(200, JSON.stringify({ ok: true }));
    // 답을 다 보내고 나서 끝낸다. 도커가 다시 띄우고, 그때는 설정이 있으므로
    // 진입 스크립트가 앱 쪽으로 간다.
    setTimeout(() => process.exit(0), 500);
    return;
  }

  send(404, JSON.stringify({ error: "not found" }));
});

if (existsSync(join(CONFIG_DIR, "setup.json"))) {
  console.log("이미 설정돼 있습니다. 마법사를 띄우지 않습니다.");
  process.exit(0);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`설치 마법사: :${PORT} — 브라우저로 열어 값을 채우세요.`);
});
