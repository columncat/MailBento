"use client";

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";

import { apiPath } from "@/lib/api-path";
import { readJson } from "@/lib/read-json";

/**
 * 대화 속 메일 — `[[mail:<메일함id>:<메시지id>]]`.
 *
 * MailBento 와 MemoBento 가 **같은 파일**을 쓴다. 메모함은 메일을 모르므로
 * 에이전트 다리에게 물어보고(`/api/agent/mails`), 메일함 쪽도 같은 길로 간다 —
 * 한쪽만 다르게 짜면 두 채팅창이 갈라진다.
 *
 * 다리는 **메일함의 최근 목록**에서만 찾는다. 본문을 여는 입구는 안 읽은 메일을
 * 읽음으로 바꿔 버려서다. 그래서 목록에서 빠진 오래된 메일은 "목록에 없는
 * 메일" 로 보인다. 지워졌다는 뜻이 아니다.
 *
 * 누를 것이 없다. 메일을 여는 것은 메일함 화면에서, 다루는 것은 에이전트에게.
 */

export interface MailCard {
  id: string;
  mailboxId: number;
  messageId: string;
  subject: string;
  from: string;
  mailbox: string;
  receivedAt: number;
  unread: boolean;
}

/** 한 번 받아 온 것은 들고 있는다 — 조각들이 서로를 모르므로 모듈에 둔다. */
const cache = new Map<string, MailCard | null>();
const inflight = new Map<string, Promise<MailCard | null>>();

/** `+` 에서 고른 것은 이미 손에 있다. 다시 묻지 않게 미리 넣어 둔다. */
export function rememberMail(card: MailCard): void {
  cache.set(card.id, card);
}

async function fetchMail(id: string): Promise<MailCard | null> {
  if (cache.has(id)) return cache.get(id) ?? null;
  const running = inflight.get(id);
  if (running) return running;

  const p = (async () => {
    try {
      const res = await fetch(apiPath(`/api/agent/mails?ids=${encodeURIComponent(id)}`), {
        cache: "no-store",
      });
      const json = await readJson<{ mails?: MailCard[] }>(res);
      const found = json.mails?.find((m) => m.id === id) ?? null;
      cache.set(id, found);
      return found;
    } catch {
      // 못 받은 것은 캐시에 넣지 않는다. 잠깐 끊긴 것뿐일 수 있다.
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

/** 받은 때를 짧게. 오늘이면 시각만, 올해면 월·일, 그 밖에는 연도까지. */
export function formatReceived(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

const chip = (text: string) => (
  <span className="rounded bg-(--color-bg) px-1.5 py-0.5 text-[12px] text-(--color-fg-4)">
    {text}
  </span>
);

export function MailRef({ mailRef, block }: { mailRef: string; block: boolean }) {
  const [mail, setMail] = useState<MailCard | null | undefined>(() =>
    cache.has(mailRef) ? cache.get(mailRef) : undefined,
  );

  useEffect(() => {
    if (mail !== undefined) return;
    let alive = true;
    void fetchMail(mailRef).then((m) => {
      if (alive) setMail(m);
    });
    return () => {
      alive = false;
    };
  }, [mailRef, mail]);

  if (mail === undefined) return chip("메일 불러오는 중…");
  if (mail === null) return chip("목록에 없는 메일");

  if (!block) {
    return (
      <span className="inline-flex max-w-full items-baseline gap-1 rounded bg-(--color-bg) px-1.5 py-0.5 text-[12px] text-(--color-fg-2) ring-1 ring-(--color-border-soft)">
        <Mail className="h-3 w-3 shrink-0 self-center opacity-60" />
        <span className="truncate">{mail.subject}</span>
      </span>
    );
  }

  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-(--color-bg) px-3 py-2 ring-1 ring-(--color-border-soft)">
      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-(--color-fg-4)" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-relaxed break-words text-(--color-fg-2)">
          {mail.unread && (
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-(--color-accent) align-middle" />
          )}
          {mail.subject}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-(--color-fg-4)">
          {[mail.from, mail.mailbox, formatReceived(mail.receivedAt)].join(" · ")}
        </p>
      </div>
    </div>
  );
}
