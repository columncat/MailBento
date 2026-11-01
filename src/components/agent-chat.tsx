"use client";

import {
  Check,
  Loader2,
  Mail,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  StickyNote,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { LedgerRef } from "@/components/ledger-ref";
import { formatReceived, MailRef, rememberMail, type MailCard } from "@/components/mail-ref";
import { RichText, type MemoSlot } from "@/components/rich-text";
import { isUnauthenticated, readJson } from "@/lib/read-json";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-path";

/**
 * 에이전트와의 채팅창.
 *
 * 브라우저는 BentoAgent 를 직접 부르지 않는다. 이 앱의 `/api/agent/chat` 이
 * 대신 불러 준다 — 토큰이 화면에 실리지 않고, 이미 있는 로그인이 그대로
 * 경계가 된다.
 *
 * 보이는 대화는 **웹으로 주고받은 것만**이다. 맥락 자체는 에이전트 쪽 세션
 * 하나이고 Discord 와 공유하지만, 화면에 Discord 대화까지 끌어오면 어디서 한
 * 말인지 뒤섞인다. 그래서 기록은 창구별로 두고 맥락만 공유한다.
 */

interface Turn {
  role: "me" | "agent";
  text: string;
  at?: number;
  denials?: string[];
  error?: boolean;
}

/** 올려 두고 아직 안 보낸 파일. */
interface Attached {
  id: string;
  name: string;
  kind: string;
  /** 모델이 내용을 그대로 볼 수 있는 것인가 (그림·PDF). */
  shown: boolean;
}

/**
 * `+` 로 붙인 메일·메모. 보낼 때 말 끝에 `[[mail:…]]` · `[[memo:…]]` 로 실린다.
 *
 * 파일과 달리 미리 올릴 것이 없다 — 이미 메일함·메모함에 있는 것을 가리킬
 * 뿐이다. 에이전트는 그 표시를 보고 도구로 읽는다 (prompt.ts "사용자가 붙인
 * 메일·메모").
 */
interface PickedRef {
  kind: "mail" | "memo";
  id: string;
  label: string;
}

/** `+` 에서 고를 메모 후보. 다리의 `/refs?kind=memo` 모양. */
interface MemoPick {
  id: string;
  label: string;
  notebook: string;
}

/** 한 번에 붙이는 상한. 에이전트가 하나하나 읽어야 하니 끝이 있어야 한다. */
const MAX_REFS = 10;

/** 말 속의 참조 표시. 내 말풍선에서 걷어내 카드 조각으로 바꿔 그린다. */
const REF_IN_TEXT =
  /\[\[(mail|memo|ledger):(\d{1,9}:[A-Za-z0-9_.=+/-]{1,200}|[A-Za-z0-9_-]{1,64}(?:@\d{4}-\d{2}-\d{2})?)\]\]/g;

/** 진행 중인 요청의 상태. 에이전트가 도구를 부를 때마다 값이 바뀐다. */
interface Status {
  state: "running" | "done";
  elapsedMs: number;
  toolCount: number;
  lastTool: string | null;
  reply?: string;
  isError?: boolean;
  denials?: string[];
}

/** 물어보는 간격. 짧게 여러 번이 긴 연결 하나보다 안전하다. */
const POLL_MS = 2000;

/** `mcp__memobento__list_notebooks` → `memobento·list_notebooks`. 보기 위한 것뿐이다. */
function shortTool(name: string): string {
  return name.replace(/^mcp__/, "").replace(/__/g, "·");
}

interface Props {
  /**
   * 답변 안의 `[[memo:<id>]]` 를 무엇으로 바꿔 그릴지.
   *
   * 이 창은 두 앱이 같은 파일을 쓴다. 메모를 아는 쪽만 넘겨 주고, 모르는
   * 쪽은 넘기지 않는다 — 없으면 id 가 회색 글자로 남을 뿐이다.
   */
  renderMemoRef?: MemoSlot;
}

/**
 * 장부 항목은 이 창이 스스로 그린다. 두 앱 모두 다리를 거쳐 읽으므로 넘겨받을
 * 것이 없다 — 메모처럼 앱마다 다를 까닭이 없다.
 */
const ledgerSlot = (entryId: string, block: boolean) => (
  <LedgerRef entryId={entryId} block={block} />
);

/** 메일도 같다. 두 앱 모두 다리를 거쳐 읽는다 (mail-ref.tsx). */
const mailSlot = (mailRef: string, block: boolean) => <MailRef mailRef={mailRef} block={block} />;

/**
 * 내가 보낸 말. 쓴 그대로 두되 **참조 표시만** 조각으로 바꾼다.
 *
 * 서식을 입히지 않는 까닭은 그대로다(내가 친 별표가 사라지면 무엇을 보냈는지
 * 되짚을 수 없다). 다만 `+` 로 붙인 `[[mail:3:184467]]` 를 날것으로 두면
 * 무엇을 붙였는지 알 수 없다 — 그것만 아래에 조각으로 모은다.
 */
function MyText({ text, memoSlot }: { text: string; memoSlot?: MemoSlot }) {
  const refs = [...text.matchAll(REF_IN_TEXT)].map((m) => ({ kind: m[1], id: m[2] }));
  if (refs.length === 0) return <span className="whitespace-pre-wrap">{text}</span>;
  const body = text.replace(REF_IN_TEXT, "").replace(/\n{3,}/g, "\n\n").trim();
  const piece = (kind: string, id: string): ReactNode =>
    kind === "mail" ? mailSlot(id, false) : kind === "ledger" ? ledgerSlot(id, false) : memoSlot?.(id, false);
  return (
    <>
      {body && <span className="whitespace-pre-wrap">{body}</span>}
      <span className={cn("flex flex-wrap gap-1", body && "mt-1.5")}>
        {refs.map((r, i) => (
          <span key={i} className="max-w-full">
            {piece(r.kind, r.id) ?? (
              <span className="font-mono text-[11px] opacity-70">
                {r.kind}:{r.id}
              </span>
            )}
          </span>
        ))}
      </span>
    </>
  );
}

/**
 * `+` → 메일 / 메모 를 골랐을 때 뜨는 고르기 창.
 *
 * 후보는 다리에게 묻는다(`/api/agent/refs`). 메일함은 메모를, 메모함은 메일을
 * 모르므로, 두 앱이 같은 파일을 쓰려면 둘 다 그 길로 가야 한다.
 * 고르면 닫지 않는다 — 여러 개를 연달아 붙이는 일이 잦다. 다시 누르면 뺀다.
 */
function RefPicker({
  kind,
  picked,
  onToggle,
  onClose,
}: {
  kind: "mail" | "memo";
  picked: PickedRef[];
  onToggle: (r: PickedRef, mail?: MailCard) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<(MailCard | MemoPick)[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [kind]);

  // 칠 때마다 묻지 않는다. 손을 멈추면 묻는다.
  useEffect(() => {
    let alive = true;
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/agent/refs?kind=${kind}&q=${encodeURIComponent(q.trim())}`,
          { cache: "no-store" },
        );
        const j = await readJson<{ mails?: MailCard[]; memos?: MemoPick[] }>(res);
        if (alive) setItems((kind === "mail" ? j.mails : j.memos) ?? []);
      } catch (e) {
        if (alive) {
          setItems([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [kind, q]);

  const isPicked = (id: string) => picked.some((p) => p.kind === kind && p.id === id);
  const full = picked.length >= MAX_REFS;

  return (
    <div className="absolute right-4 bottom-full left-4 z-10 mb-2 flex max-h-[min(420px,60vh)] flex-col overflow-hidden rounded-xl bg-(--color-surface) shadow-xl ring-1 ring-(--color-border-soft)">
      <div className="flex shrink-0 items-center gap-2 border-b border-(--color-border-soft) px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-(--color-fg-4)" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === "mail" ? "제목·보낸 사람·메일함으로 찾기" : "내용·메모함 이름으로 찾기"}
          className="min-w-0 flex-1 bg-transparent text-sm text-(--color-fg) outline-none placeholder:text-(--color-fg-4)"
        />
        <span className="shrink-0 text-[11px] text-(--color-fg-4)">
          {kind === "mail" ? "메일" : "메모"} · {picked.length}/{MAX_REFS}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
          aria-label="닫기"
          title="닫기 (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1">
        {items === null && (
          <p className="flex items-center gap-2 px-3 py-4 text-[13px] text-(--color-fg-4)">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            불러오는 중…
          </p>
        )}
        {error && <p className="px-3 py-3 text-[13px] text-(--color-danger)">{error}</p>}
        {items !== null && !error && items.length === 0 && (
          <p className="px-3 py-4 text-[13px] text-(--color-fg-4)">
            {q.trim() ? "맞는 것이 없습니다." : kind === "mail" ? "최근 메일이 없습니다." : "메모가 없습니다."}
          </p>
        )}
        {items?.map((it) => {
          const mail = kind === "mail" ? (it as MailCard) : null;
          const memo = kind === "memo" ? (it as MemoPick) : null;
          const label = mail ? mail.subject : memo!.label;
          const sub = mail
            ? `${mail.from} · ${mail.mailbox} · ${formatReceived(mail.receivedAt)}`
            : memo!.notebook;
          const on = isPicked(it.id);
          return (
            <button
              key={it.id}
              type="button"
              disabled={!on && full}
              onClick={() => onToggle({ kind, id: it.id, label }, mail ?? undefined)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-(--color-surface-2) disabled:opacity-40",
                on && "bg-(--color-accent-soft)",
              )}
            >
              {mail ? (
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-(--color-fg-4)" />
              ) : (
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-(--color-fg-4)" />
              )}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[13px] break-words text-(--color-fg-2)">
                  {mail?.unread && (
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-(--color-accent) align-middle" />
                  )}
                  {label}
                </span>
                <span className="block truncate text-[11px] text-(--color-fg-4)">{sub}</span>
              </span>
              {on && <Check className="mt-0.5 h-4 w-4 shrink-0 text-(--color-accent)" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AgentChat({ renderMemoRef }: Props = {}) {
  // 설정되지 않은 배포에서는 버튼 자체를 두지 않는다. 눌러야 알 수 있는
  // 것보다, 없는 편이 낫다.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  /*
   * 붙여 놓고 아직 안 보낸 파일.
   *
   * 고르는 즉시 올린다. 보낼 때 한꺼번에 올리면 25MB 짜리를 기다리는 동안
   * 아무 표시가 없고, 앞의 터널이 100초에서 끊는다. 먼저 올려 두면 보내는
   * 요청은 번호만 실어 짧게 끝난다.
   *
   * 올라간 파일은 그 자리에서 이미 Inbox 메모함에 들어간다. 여기서 지워도
   * 그건 "이번 말에 딸려 보내지 않는다" 는 뜻이지, 파일이 사라지는 것은 아니다.
   */
  const [attached, setAttached] = useState<Attached[]>([]);
  const [uploading, setUploading] = useState(0);
  /** `+` 로 붙인 메일·메모. */
  const [refs, setRefs] = useState<PickedRef[]>([]);
  /** `+` 메뉴가 열렸는지, 고르기 창이 무엇을 보이는지. */
  const [plusOpen, setPlusOpen] = useState(false);
  const [picker, setPicker] = useState<"mail" | "memo" | null>(null);
  const plusRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<Status | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** 보내는 중인지. 상태가 아니라 ref 인 이유는 send() 안에 적어 뒀다. */
  const sending = useRef(false);

  useEffect(() => {
    apiFetch("/api/agent/chat")
      .then((r) => r.json())
      .then((j: { configured?: boolean }) => setEnabled(j.configured === true))
      .catch(() => setEnabled(false));
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const r = await apiFetch("/api/agent/chat?history=1");
      const j = await readJson<{ turns?: Turn[] }>(r);
      if (Array.isArray(j.turns)) setTurns(j.turns);
    } catch (e) {
      // 못 불러와도 새로 대화할 수는 있다. 다만 조용히 넘기면 지난 대화가
      // 없는 것처럼 보이므로, 왜 비었는지는 한 줄 남긴다.
      setTurns([
        {
          role: "agent",
          text: isUnauthenticated(e)
            ? "로그인이 풀려 지난 대화를 불러오지 못했습니다. 새로고침해 주세요."
            : `지난 대화를 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
          at: Date.now(),
          error: true,
        },
      ]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // 열 때마다 다시 읽는다. 다른 탭이나 창에서 주고받은 것도 따라온다.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    void loadHistory();
  }, [open, loadHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  // 큰 창이라 Esc 로 닫히는 편이 자연스럽다. 다만 고르기 창이나 `+` 메뉴가
  // 떠 있으면 그것부터 닫는다 — 고르다 Esc 를 눌렀는데 대화창이 통째로 닫히면
  // 쓰던 말까지 화면에서 사라진다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picker || plusOpen) {
        setPicker(null);
        setPlusOpen(false);
        inputRef.current?.focus();
        return;
      }
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, picker, plusOpen]);

  // `+` 메뉴는 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!plusRef.current?.contains(e.target as Node)) setPlusOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [plusOpen]);

  const toggleRef = (r: PickedRef, mail?: MailCard) => {
    if (mail) rememberMail(mail);
    setRefs((prev) =>
      prev.some((p) => p.kind === r.kind && p.id === r.id)
        ? prev.filter((p) => !(p.kind === r.kind && p.id === r.id))
        : prev.length >= MAX_REFS
          ? prev
          : [...prev, r],
    );
  };

  /**
   * 답이 나올 때까지 물어본다.
   *
   * 예전에는 한 요청을 붙들고 답을 기다렸는데, 이 앱 앞의 Cloudflare 터널이
   * 원본 응답을 100초까지만 기다린다. 도구를 쓰는 답은 대개 그보다 오래 걸려서
   * 거의 매번 끊겼다. 지금은 시작만 시키고 짧게 여러 번 물어본다.
   */
  const poll = async (job: string): Promise<Status> => {
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const res = await apiFetch(`/api/agent/chat?job=${encodeURIComponent(job)}`);
      // 404 는 "그런 작업이 없다" 이므로 오류로 던지기 전에 먼저 본다.
      if (res.status === 404) {
        // 에이전트가 다시 켜졌다. 답이 어디까지 갔는지는 기록에 남아 있다.
        await loadHistory();
        throw new Error("에이전트가 다시 시작되어 이 요청은 사라졌습니다");
      }
      const json = await readJson<Status>(res);
      setProgress(json);
      if (json.state === "done") return json;
    }
  };

  /** 고른 파일을 그 자리에서 올린다. 실패한 것은 말해 준다. */
  const attach = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = [...files];
    if (list.length === 0) return;
    const room = 5 - attached.length;
    const picked = list.slice(0, Math.max(0, room));
    if (picked.length === 0) return;

    setUploading((n) => n + picked.length);
    for (const file of picked) {
      const form = new FormData();
      form.append("file", file, file.name);
      try {
        const res = await apiFetch("/api/agent/upload", { method: "POST", body: form });
        const j = await readJson<Attached & { error?: string }>(res);
        if (!j.id) throw new Error(j.error || "올리지 못했습니다");
        setAttached((prev) => [...prev, { id: j.id, name: j.name, kind: j.kind, shown: !!j.shown }]);
      } catch (e) {
        setTurns((t) => [
          ...t,
          {
            role: "agent",
            text: `${file.name} 을 올리지 못했습니다: ${
              e instanceof Error ? e.message : String(e)
            }`,
            at: Date.now(),
            error: true,
          },
        ]);
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
  };

  /*
   * 붙여넣기로 들어온 그림.
   *
   * 화면을 캡처해 바로 주는 것이 가장 잦은 쓰임인데, 그때마다 파일로 저장해
   * 다시 고르게 하는 것은 번거롭다.
   *
   * 이름을 갈아 준다. 캡처는 대개 `image.png` 라는 한 가지 이름으로 오는데,
   * 그대로 두면 Inbox 에 같은 이름이 줄줄이 쌓여 무엇이 무엇인지 알 수 없다.
   * 보낸 쪽이 제 이름을 붙여 온 것은 건드리지 않는다.
   */
  const onPaste = (e: React.ClipboardEvent) => {
    const items = [...(e.clipboardData?.items ?? [])];
    const files = items
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    // 글도 함께 들어 있으면 글은 그대로 붙게 두고 파일만 가져간다.
    if (!items.some((it) => it.kind === "string")) e.preventDefault();

    const stamped = files.map((f) => {
      if (f.name && !/^image\.\w+$/i.test(f.name)) return f;
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const ext = (f.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
      const name =
        `붙여넣기 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
      return new File([f], name, { type: f.type });
    });
    void attach(stamped);
  };

  const send = async () => {
    // busy 는 상태라 곧바로 반영되지 않는다. Enter 를 연달아 치면 둘 다
    // 통과해서 같은 질문이 두 번 들어간다. 문지기는 ref 로 둔다.
    // 파일만, 붙인 메일만 보내는 것도 말이 된다. 글이 없다는 이유로 버리지 않는다.
    if ((!draft.trim() && attached.length === 0 && refs.length === 0) || sending.current) return;
    sending.current = true;
    /*
     * 붙인 것은 **말 끝에 표시로** 싣는다. 따로 칸을 두지 않는 까닭은, 이 말이
     * 공용 세션에 그대로 남아야 다음 턴의 "그거" 가 무엇인지 에이전트가 알기
     * 때문이다. 기록(/history)에도 같은 글이 남아 다시 열어도 조각이 그려진다.
     */
    const tokens = refs.map((r) => `[[${r.kind}:${r.id}]]`).join("\n");
    const message = [draft.trim(), tokens].filter(Boolean).join("\n\n");
    const files = attached;
    setDraft("");
    setAttached([]);
    setRefs([]);
    setPicker(null);
    setTurns((t) => [
      ...t,
      {
        role: "me",
        text:
          message +
          (files.length
            ? `${message ? "\n\n" : ""}[보낸 파일] ${files.map((f) => f.name).join(", ")}`
            : ""),
        at: Date.now(),
      },
    ]);
    setBusy(true);
    setProgress(null);
    try {
      const res = await apiFetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          ...(files.length ? { attachments: files.map((f) => f.id) } : {}),
        }),
      });
      const started = await readJson<{ id?: string }>(res);
      if (!started.id) throw new Error("에이전트가 작업 번호를 주지 않았습니다");
      const done = await poll(started.id);
      setTurns((t) => [
        ...t,
        {
          role: "agent",
          text: done.reply ?? "[빈 응답]",
          at: Date.now(),
          denials: done.denials,
          error: done.isError === true,
        },
      ]);
    } catch (e) {
      setTurns((t) => [
        ...t,
        {
          role: "agent",
          text: isUnauthenticated(e)
            ? "로그인이 풀렸습니다. 새로고침해서 다시 로그인한 뒤 이어 주세요. 보낸 말은 서버에서 계속 처리되고 있을 수 있습니다."
            : e instanceof Error
              ? e.message
              : String(e),
          at: Date.now(),
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
      setProgress(null);
      sending.current = false;
    }
  };

  const reset = async () => {
    if (!confirm("맥락과 이 창의 기록을 모두 지웁니다. Discord 쪽 맥락도 함께 사라집니다. 진행할까요?")) {
      return;
    }
    await apiFetch("/api/agent/chat", { method: "DELETE" }).catch(() => undefined);
    setTurns([]);
  };

  if (enabled !== true) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full bg-(--color-surface) px-4 py-2 text-sm text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
        aria-label="에이전트와 대화"
        title="에이전트와 대화 — 메일함과 메모함 권한이 있습니다"
      >
        <Sparkles className="h-4 w-4" />
        대화
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-(--color-bg)/70 backdrop-blur-[2px]"
          />
          {/* 화면을 거의 다 쓴다 — 긴 답과 지난 대화를 함께 보려면 좁아서는 안 된다 */}
          <section className="relative flex h-[92vh] w-[min(1080px,96vw)] flex-col overflow-hidden rounded-[var(--radius-card)] bg-(--color-surface) shadow-2xl ring-1 ring-(--color-border-soft)">
            <header className="flex shrink-0 items-center justify-between border-b border-(--color-border-soft) px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-(--color-accent-strong)" />
                <span className="truncate text-sm font-medium text-(--color-fg)">
                  에이전트
                </span>
                <span className="shrink-0 text-[11px] break-keep text-(--color-fg-4)">
                  메일함과 메모함 권한이 있습니다
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void reset()}
                  className="grid h-8 w-8 place-items-center rounded-lg text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
                  aria-label="새 대화"
                  title="새 대화 — 맥락과 기록을 지웁니다 (Discord 쪽 맥락도 함께)"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
                  aria-label="닫기"
                  title="닫기 (Esc)"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </header>

            <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {loadingHistory && turns.length === 0 && (
                <div className="flex items-center gap-2 px-1 py-8 text-[13px] text-(--color-fg-4)">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  지난 대화를 불러오는 중…
                </div>
              )}
              {!loadingHistory && turns.length === 0 && (
                <p className="px-1 py-12 text-center text-sm break-keep text-(--color-fg-4)">
                  메모함과 메일함을 읽고 고칠 수 있습니다.
                  <br />
                  &ldquo;오늘 안 읽은 메일 정리해줘&rdquo; 처럼 말해 보세요.
                </p>
              )}
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[min(72ch,88%)] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
                    t.role === "me"
                      ? "ml-auto bg-(--color-accent-soft) text-(--color-accent-strong)"
                      : t.error
                        ? "bg-(--color-danger)/15 text-(--color-danger)"
                        : "bg-(--color-bg-2) text-(--color-fg-2)",
                  )}
                >
                  {/*
                    내가 쓴 말은 쓴 그대로 둔다. 서식을 입히면 내가 친 별표가
                    사라져 무슨 말을 보냈는지 되짚을 수 없다.
                  */}
                  {t.error ? (
                    <span className="whitespace-pre-wrap">{t.text}</span>
                  ) : t.role === "me" ? (
                    <MyText text={t.text} memoSlot={renderMemoRef} />
                  ) : (
                    <RichText
                      text={t.text}
                      memoSlot={renderMemoRef}
                      ledgerSlot={ledgerSlot}
                      mailSlot={mailSlot}
                    />
                  )}
                  {t.denials && t.denials.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-(--color-warn)">
                      허용되지 않은 도구를 쓰려고 했습니다: {t.denials.join(", ")}
                    </p>
                  )}
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-[12px] text-(--color-fg-4)">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {progress ? (
                    <span>
                      {Math.round(progress.elapsedMs / 1000)}초째
                      {progress.toolCount > 0 && ` · 도구 ${progress.toolCount}회`}
                      {progress.lastTool && (
                        <span className="ml-1 font-mono text-[11px] text-(--color-fg-4)">
                          {shortTool(progress.lastTool)}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span>생각하는 중…</span>
                  )}
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="relative flex shrink-0 flex-col gap-2 border-t border-(--color-border-soft) px-4 py-3.5"
            >
              {picker && (
                <RefPicker
                  kind={picker}
                  picked={refs}
                  onToggle={toggleRef}
                  onClose={() => {
                    setPicker(null);
                    inputRef.current?.focus();
                  }}
                />
              )}
              {(attached.length > 0 || uploading > 0 || refs.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {refs.map((r) => (
                    <span
                      key={`${r.kind}:${r.id}`}
                      className="flex max-w-full items-center gap-1 rounded-full bg-(--color-bg-2) py-1 pr-1 pl-2.5 text-[11px] text-(--color-fg-2) ring-1 ring-(--color-border-soft)"
                      title={r.label}
                    >
                      {r.kind === "mail" ? (
                        <Mail className="h-3 w-3 shrink-0 opacity-60" />
                      ) : (
                        <StickyNote className="h-3 w-3 shrink-0 opacity-60" />
                      )}
                      <span className="max-w-[24ch] truncate">{r.label}</span>
                      <button
                        type="button"
                        onClick={() => toggleRef(r)}
                        className="grid h-4 w-4 shrink-0 place-items-center rounded-full hover:bg-(--color-surface-hi)"
                        aria-label={`${r.label} 빼기`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {attached.map((f) => (
                    <span
                      key={f.id}
                      className="flex max-w-full items-center gap-1 rounded-full bg-(--color-bg-2) py-1 pr-1 pl-2.5 text-[11px] text-(--color-fg-2) ring-1 ring-(--color-border-soft)"
                      title={f.shown ? `${f.name} — 내용까지 보여 줍니다` : `${f.name} — 이름만 전해집니다`}
                    >
                      <Paperclip className="h-3 w-3 shrink-0 opacity-60" />
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => setAttached((prev) => prev.filter((x) => x.id !== f.id))}
                        className="grid h-4 w-4 shrink-0 place-items-center rounded-full hover:bg-(--color-surface-hi)"
                        aria-label={`${f.name} 빼기`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {uploading > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-(--color-bg-2) px-2.5 py-1 text-[11px] text-(--color-fg-4)">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      올리는 중 {uploading}
                    </span>
                  )}
                </div>
              )}
              <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void attach(e.target.files);
                  // 같은 파일을 다시 고를 수 있게 비운다.
                  e.target.value = "";
                }}
              />
              {/*
                파일·메일·메모를 붙이는 단추 하나. 예전의 클립 단추를 이 안으로
                옮겼다 — 붙이는 것이 셋이 되면서 단추를 셋 늘어놓으면 입력칸이
                좁아진다.
              */}
              <div ref={plusRef} className="relative flex shrink-0 self-stretch">
                <button
                  type="button"
                  onClick={() => setPlusOpen((v) => !v)}
                  disabled={busy}
                  aria-haspopup="menu"
                  aria-expanded={plusOpen}
                  className="grid w-10 place-items-center rounded-lg bg-(--color-bg-2) text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:text-(--color-fg) disabled:opacity-40"
                  aria-label="붙이기"
                  title="파일·메일·메모 붙이기"
                >
                  <Plus className={cn("h-4 w-4 transition", plusOpen && "rotate-45")} />
                </button>
                {plusOpen && (
                  <div
                    role="menu"
                    className="absolute bottom-full left-0 z-20 mb-2 w-44 rounded-xl bg-(--color-surface) p-1 shadow-xl ring-1 ring-(--color-border-soft)"
                  >
                    {(
                      [
                        ["file", Paperclip, "파일", attached.length >= 5],
                        ["mail", Mail, "메일", false],
                        ["memo", StickyNote, "메모", false],
                      ] as const
                    ).map(([key, Icon, label, off]) => (
                      <button
                        key={key}
                        type="button"
                        role="menuitem"
                        disabled={off}
                        onClick={() => {
                          setPlusOpen(false);
                          if (key === "file") fileRef.current?.click();
                          else setPicker(key);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-(--color-fg-2) transition hover:bg-(--color-surface-2) disabled:opacity-40"
                      >
                        <Icon className="h-4 w-4 text-(--color-fg-4)" />
                        {label}
                        {key === "file" && (
                          <span className="ml-auto text-[10px] text-(--color-fg-4)">Inbox 에</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                onPaste={onPaste}
                rows={2}
                placeholder="무엇을 할까요? (Enter 로 전송, 그림은 붙여넣기도 됩니다)"
                className="scrollbar-thin min-w-0 flex-1 resize-none rounded-lg bg-(--color-bg-2) px-3.5 py-2.5 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60"
              />
              <button
                type="submit"
                disabled={busy || (!draft.trim() && attached.length === 0 && refs.length === 0)}
                className="grid w-12 shrink-0 place-items-center rounded-lg bg-(--color-accent) text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-40"
                aria-label="보내기"
              >
                <Send className="h-4 w-4" />
              </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
