"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * 에이전트 설정.
 *
 * 여기 있는 이유는 하나다 — **Claude 의 OAuth 토큰은 만료된다.** 만료되면
 * 에이전트가 아무 일도 못 하는데, 그걸 되살리자고 기계에 접속해 파일을 고치고
 * 컨테이너를 다시 띄우는 것은 번거롭다.
 *
 * 토큰은 어느 방향으로도 화면에 오지 않는다. 들어 있는지와 어떤 종류인지만
 * 받아 보여 준다. 빈 칸은 늘 "그대로 두라" 는 뜻이다.
 */

interface Settings {
  claudeAuth: "oauth" | "apiKey" | "none";
  discordEnabled: boolean;
  discordConfigured: boolean;
  model: string;
  writable: boolean;
}

const AUTH_LABEL: Record<Settings["claudeAuth"], string> = {
  oauth: "OAuth 토큰 (구독)",
  apiKey: "API 키 (종량 과금)",
  none: "없음 — 에이전트가 아무것도 못 합니다",
};

export function AgentPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [oauth, setOauth] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [discordToken, setDiscordToken] = useState("");
  const [discordOwner, setDiscordOwner] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/config", { cache: "no-store" });
      const j = (await r.json()) as Settings & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `불러오지 못했습니다 (${r.status})`);
      setS(j);
      setModel(j.model ?? "");
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch("/api/agent/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = (await r.json()) as { changed?: boolean; error?: string };
      if (!r.ok) throw new Error(j.error ?? `저장하지 못했습니다 (${r.status})`);
      if (j.changed) {
        setMsg("저장했습니다. 에이전트가 다시 시작합니다 (10초쯤).");
        setOauth("");
        setApiKey("");
        setDiscordToken("");
        setDiscordOwner("");
        // 다시 뜰 때까지 기다렸다가 상태를 새로 읽는다.
        setTimeout(() => void load(), 10_000);
      } else {
        setMsg("바뀐 것이 없습니다.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 에이전트가 없는 배포에서는 이 칸 자체를 두지 않는다.
  if (err && !s) {
    return (
      <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <h2 className="mb-1 text-lg font-medium text-(--color-fg)">에이전트</h2>
        <p className="text-sm text-(--color-fg-4)">{err}</p>
      </section>
    );
  }
  if (!s) {
    return (
      <section className="flex items-center gap-2 rounded-[var(--radius-card)] bg-(--color-surface) p-6 text-sm text-(--color-fg-4) ring-1 ring-(--color-border-soft)">
        <Loader2 className="h-4 w-4 animate-spin" />
        에이전트 설정을 불러오는 중…
      </section>
    );
  }

  const input =
    "w-full rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60";
  const label = "mt-3 mb-1 block text-[13px] text-(--color-fg-2)";
  const button =
    "rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-40";

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <h2 className="mb-1 text-lg font-medium text-(--color-fg)">에이전트</h2>
      <p className="mb-4 text-sm break-keep text-(--color-fg-4)">
        Claude 인증과 Discord 연결. 토큰은 화면에 다시 보이지 않으니, 빈 칸은 그대로
        둔다는 뜻입니다.
      </p>

      {!s.writable && (
        <p className="mb-4 rounded-lg bg-(--color-warn)/15 px-3 py-2 text-[13px] break-keep text-(--color-warn)">
          이 배포는 설정을 파일이 아니라 환경변수로 받습니다. 여기서는 현재 상태만 보이고
          고칠 수는 없습니다.
        </p>
      )}
      {err && (
        <p className="mb-4 rounded-lg bg-(--color-danger)/15 px-3 py-2 text-[13px] break-keep text-(--color-danger)">
          {err}
        </p>
      )}
      {msg && (
        <p className="mb-4 rounded-lg bg-(--color-accent-soft) px-3 py-2 text-[13px] break-keep text-(--color-accent-strong)">
          {msg}
        </p>
      )}

      <div className="rounded-lg bg-(--color-bg-2) px-3.5 py-3 text-[13px] text-(--color-fg-2)">
        <div className="flex justify-between gap-3">
          <span className="text-(--color-fg-4)">지금 쓰는 Claude 인증</span>
          <span className={cn(s.claudeAuth === "none" && "text-(--color-danger)")}>
            {AUTH_LABEL[s.claudeAuth]}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between gap-3">
          <span className="text-(--color-fg-4)">Discord</span>
          <span className={cn(!s.discordEnabled && "text-(--color-fg-4)")}>
            {s.discordEnabled ? "켜짐" : "꺼짐"}
            {!s.discordConfigured && " · 봇 정보 없음"}
          </span>
        </div>
      </div>

      <label className={label}>
        새 OAuth 토큰 <span className="text-(--color-fg-4)">(구독 — 컴퓨터에서 claude setup-token)</span>
      </label>
      <input
        type="password"
        value={oauth}
        onChange={(e) => setOauth(e.target.value)}
        placeholder="sk-ant-oat…"
        className={input}
        autoComplete="off"
        disabled={!s.writable}
      />

      <label className={label}>
        또는 새 API 키 <span className="text-(--color-fg-4)">(종량 과금)</span>
      </label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="sk-ant-api…"
        className={input}
        autoComplete="off"
        disabled={!s.writable}
      />

      <label className={label}>
        모델 <span className="text-(--color-fg-4)">(비우면 기본값)</span>
      </label>
      <input
        type="text"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="예: opus / sonnet"
        className={input}
        disabled={!s.writable}
      />

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className={button}
          disabled={busy || !s.writable || (!oauth.trim() && !apiKey.trim() && model === s.model)}
          onClick={() =>
            void save({
              ...(oauth.trim() ? { claudeOauthToken: oauth.trim() } : {}),
              ...(apiKey.trim() ? { anthropicApiKey: apiKey.trim() } : {}),
              model,
            })
          }
        >
          {busy ? "저장하는 중…" : "Claude 설정 저장"}
        </button>
      </div>

      <hr className="my-5 border-(--color-border-soft)" />

      <h3 className="text-sm font-medium text-(--color-fg)">Discord</h3>
      <p className="mt-1 text-[13px] break-keep text-(--color-fg-4)">
        끄면 봇이 접속하지 않고 새 메일 검토 요청도 보내지 않습니다. 채팅창은 그대로
        씁니다. <b>같은 봇 토큰을 두 대에서 동시에 켜면 서로를 끊습니다</b> — 예비
        기계에서는 꺼 두세요.
      </p>

      {!s.discordConfigured && (
        <>
          <label className={label}>봇 토큰</label>
          <input
            type="password"
            value={discordToken}
            onChange={(e) => setDiscordToken(e.target.value)}
            className={input}
            autoComplete="off"
            disabled={!s.writable}
          />
          <label className={label}>내 사용자 ID</label>
          <input
            type="text"
            value={discordOwner}
            onChange={(e) => setDiscordOwner(e.target.value)}
            className={input}
            disabled={!s.writable}
          />
        </>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-40",
            s.discordEnabled
              ? "bg-(--color-surface-hi) text-(--color-fg-2) hover:bg-(--color-bg-2)"
              : "bg-(--color-accent) text-(--color-bg) hover:bg-(--color-accent-strong)",
          )}
          disabled={busy || !s.writable}
          onClick={() =>
            void save({
              discordEnabled: !s.discordEnabled,
              ...(discordToken.trim() ? { discordToken: discordToken.trim() } : {}),
              ...(discordOwner.trim() ? { discordOwnerId: discordOwner.trim() } : {}),
            })
          }
        >
          {s.discordEnabled ? "Discord 끄기" : "Discord 켜기"}
        </button>
      </div>
    </section>
  );
}
