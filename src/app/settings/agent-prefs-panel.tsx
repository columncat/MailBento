"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api-path";
import { readJson } from "@/lib/read-json";
import { cn } from "@/lib/utils";

/**
 * 에이전트의 알림과 안내문.
 *
 * 위의 "에이전트" 칸(인증·Discord)과 나눈 까닭은 저장했을 때 일어나는 일이
 * 달라서다. 그쪽은 에이전트가 다시 뜨고, 이쪽은 **다음 요청부터 바로** 먹는다.
 * 한 칸에 섞으면 알림 하나 끄는데 재시작을 각오해야 하는 것처럼 보인다.
 *
 * 값은 에이전트 쪽(`data/bentoagent/prefs.json`)에 산다. 이 앱은 넘겨줄 뿐이다.
 */

interface Prefs {
  mailAlerts: boolean;
  /** null 이면 기본 기준을 쓰는 중. */
  triageCriteria: string | null;
  extraInstructions: string | null;
  defaults: { triageCriteria: string };
  maxLength: number;
}

export function AgentPrefsPanel() {
  const [p, setP] = useState<Prefs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [criteria, setCriteria] = useState("");
  const [extra, setExtra] = useState("");

  const apply = (j: Prefs) => {
    setP(j);
    // 기본값을 쓰는 중이면 기본 글을 채워 보여 준다 — 무엇을 고치는지 보여야 고친다.
    setCriteria(j.triageCriteria ?? j.defaults.triageCriteria);
    setExtra(j.extraInstructions ?? "");
  };

  const load = useCallback(async () => {
    try {
      const r = await apiFetch("/api/agent/prefs", { cache: "no-store" });
      apply(await readJson<Prefs>(r));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (what: string, patch: Partial<Prefs>, done: string) => {
    setBusy(what);
    setErr(null);
    setMsg(null);
    try {
      const r = await apiFetch("/api/agent/prefs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      apply(await readJson<Prefs>(r));
      setMsg(done);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const resetSession = async () => {
    if (
      !confirm(
        "에이전트와의 대화 맥락을 지우고 새로 시작합니다. 채팅창 기록과 Discord 쪽 맥락도 함께 사라집니다. 진행할까요?",
      )
    ) {
      return;
    }
    setBusy("reset");
    setErr(null);
    setMsg(null);
    try {
      // 채팅창의 "새 대화" 단추, Discord 의 `/new` 와 같은 길이다.
      const r = await apiFetch("/api/agent/chat", { method: "DELETE" });
      await readJson(r);
      setMsg("대화 세션을 초기화했습니다. 다음 말부터 새 대화입니다.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (err && !p) {
    return (
      <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <h2 className="mb-1 text-lg font-medium text-(--color-fg)">알림과 안내문</h2>
        <p className="text-sm text-(--color-fg-4)">{err}</p>
      </section>
    );
  }
  if (!p) {
    return (
      <section className="flex items-center gap-2 rounded-[var(--radius-card)] bg-(--color-surface) p-6 text-sm text-(--color-fg-4) ring-1 ring-(--color-border-soft)">
        <Loader2 className="h-4 w-4 animate-spin" />
        알림 설정을 불러오는 중…
      </section>
    );
  }

  const area =
    "scrollbar-thin w-full resize-y rounded-lg bg-(--color-bg-2) px-3 py-2 font-mono text-[12.5px] leading-relaxed text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60";
  const button =
    "rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-40";
  const ghost =
    "rounded-lg px-3 py-2 text-sm text-(--color-fg-3) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg) disabled:opacity-40";
  const usingDefault = p.triageCriteria === null;
  const criteriaDirty = criteria !== (p.triageCriteria ?? p.defaults.triageCriteria);
  const extraDirty = extra !== (p.extraInstructions ?? "");
  const counter = (n: number) => (
    <span className={cn("text-[11px]", n > p.maxLength ? "text-(--color-danger)" : "text-(--color-fg-4)")}>
      {n.toLocaleString()} / {p.maxLength.toLocaleString()}자
    </span>
  );

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <h2 className="mb-1 text-lg font-medium text-(--color-fg)">알림과 안내문</h2>
      <p className="mb-4 text-sm break-keep text-(--color-fg-4)">
        저장하면 다음 요청부터 바로 적용됩니다. 에이전트가 다시 시작하지 않습니다.
      </p>

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

      {/* ── 메일 알림 ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-(--color-fg)">새 메일 Discord 알림</h3>
          <p className="mt-1 text-[13px] break-keep text-(--color-fg-4)">
            새 메일의 제목만 보고 읽어 볼 만한 것을 골라 Discord 로 물어봅니다. 끄면 고르는
            일도 하지 않습니다. Discord 자체가 꺼져 있으면 이 스위치와 상관없이 묻지 않습니다.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={p.mailAlerts}
          disabled={busy !== null}
          onClick={() =>
            void save(
              "alerts",
              { mailAlerts: !p.mailAlerts },
              p.mailAlerts ? "새 메일 알림을 껐습니다." : "새 메일 알림을 켰습니다.",
            )
          }
          className={cn(
            "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50",
            p.mailAlerts ? "bg-(--color-accent)" : "bg-(--color-bg-2) ring-1 ring-(--color-border-soft)",
          )}
          aria-label="새 메일 Discord 알림"
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-(--color-surface) shadow transition-all",
              p.mailAlerts ? "left-[22px]" : "left-0.5",
            )}
          />
        </button>
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-3">
        <label htmlFor="triage-criteria" className="text-[13px] text-(--color-fg-2)">
          알림 판정 기준{" "}
          <span className="text-(--color-fg-4)">{usingDefault ? "(기본값 사용 중)" : "(직접 고친 것)"}</span>
        </label>
        {counter(criteria.length)}
      </div>
      <p className="mt-1 mb-1.5 text-[12px] break-keep text-(--color-fg-4)">
        어떤 메일을 물어볼지 고르는 기준입니다. 답의 형식(메일마다 Y/N 한 글자)은 따로
        고정돼 있어서, 여기를 어떻게 적어도 에이전트가 지은 문장이 알림으로 나가지는
        않습니다.
      </p>
      <textarea
        id="triage-criteria"
        value={criteria}
        onChange={(e) => setCriteria(e.target.value)}
        rows={14}
        className={area}
        spellCheck={false}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className={ghost}
          disabled={busy !== null || (usingDefault && !criteriaDirty)}
          onClick={() =>
            void save("criteria", { triageCriteria: null }, "판정 기준을 기본값으로 되돌렸습니다.")
          }
        >
          기본값으로
        </button>
        <button
          type="button"
          className={button}
          disabled={busy !== null || !criteriaDirty || criteria.length > p.maxLength}
          onClick={() =>
            void save(
              "criteria",
              // 기본 글과 똑같으면 "기본값" 으로 남긴다 — 그래야 나중에 기본 기준이
              // 나아질 때 그대로 따라간다.
              { triageCriteria: criteria.trim() === p.defaults.triageCriteria.trim() ? null : criteria },
              "판정 기준을 저장했습니다.",
            )
          }
        >
          {busy === "criteria" ? "저장하는 중…" : "기준 저장"}
        </button>
      </div>

      <hr className="my-5 border-(--color-border-soft)" />

      {/* ── 평소 대화에 덧붙일 지시 ── */}
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="extra-instructions" className="text-sm font-medium text-(--color-fg)">
          에이전트에게 덧붙일 지시
        </label>
        {counter(extra.length)}
      </div>
      <p className="mt-1 mb-1.5 text-[12px] break-keep text-(--color-fg-4)">
        Discord 와 채팅창의 평소 대화에서 기본 안내문 <b>끝에</b> 붙습니다. 기본 안내문과
        부딪치면 이쪽을 따릅니다. 기본 안내문 자체(도구 쓰는 법·카드 표시 규칙)는 바꾸지
        않습니다.
      </p>
      <textarea
        id="extra-instructions"
        value={extra}
        onChange={(e) => setExtra(e.target.value)}
        rows={6}
        placeholder={"예: 답은 세 줄 안으로.\n예: 메모를 만들면 TODO 메모함에 넣어 줘."}
        className={area}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className={ghost}
          disabled={busy !== null || (!extra && !p.extraInstructions)}
          onClick={() => void save("extra", { extraInstructions: null }, "덧붙인 지시를 지웠습니다.")}
        >
          비우기
        </button>
        <button
          type="button"
          className={button}
          disabled={busy !== null || !extraDirty || extra.length > p.maxLength}
          onClick={() =>
            void save("extra", { extraInstructions: extra.trim() ? extra : null }, "덧붙일 지시를 저장했습니다.")
          }
        >
          {busy === "extra" ? "저장하는 중…" : "지시 저장"}
        </button>
      </div>

      <hr className="my-5 border-(--color-border-soft)" />

      {/* ── 세션 초기화 ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-(--color-fg)">대화 세션 초기화</h3>
          <p className="mt-1 text-[13px] break-keep text-(--color-fg-4)">
            에이전트가 기억하는 대화 맥락을 지웁니다. 채팅창의 &ldquo;새 대화&rdquo;, Discord 의{" "}
            <code className="font-mono text-[12px]">/new</code> 와 같습니다. 장기 기억 메모와
            예약 알림은 남습니다.
          </p>
        </div>
        <button
          type="button"
          className={cn(ghost, "flex shrink-0 items-center gap-1.5 ring-1 ring-(--color-border-soft)")}
          disabled={busy !== null}
          onClick={() => void resetSession()}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {busy === "reset" ? "지우는 중…" : "초기화"}
        </button>
      </div>
    </section>
  );
}
