#!/usr/bin/env node
/**
 * MailBento MCP 서버 (stdio).
 *
 * MailBento 를 돌리는 호스트에서, 또는 그 호스트에 닿을 수 있는 곳에서 돌린다.
 * 앱의 HTTP API 만 쓴다 — IMAP 에 직접 붙지 않는다. 캐시(stale-while-revalidate),
 * 앱 내부 표식, 보관 사본 규칙이 전부 서버 쪽에 있고 우회하면 그게 다 깨진다.
 *
 * 설정은 환경변수로 받는다.
 *   MAILBENTO_URL        기본 http://127.0.0.1:3000
 *   MAILBENTO_PASSWORD   인증이 켜진 서버라면 필수
 *   MAILBENTO_TIMEOUT_MS 기본 30000 (IMAP 재조회가 느릴 수 있다)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { MailBentoClient, MailBentoError } from "./client.js";
import {
  DEFAULT_BODY_LIMIT,
  resolveInbox,
  shapeArchived,
  shapeDetail,
  shapeMessage,
  type Account,
  type ArchivedSummary,
  type MailMessageDetail,
  type MailResponse,
} from "./shape.js";

const MESSAGE_MARKS = [
  "star",
  "circle",
  "triangle",
  "cross",
  "exclaim",
  "check",
] as const;

const client = new MailBentoClient({
  baseUrl: process.env.MAILBENTO_URL ?? "http://127.0.0.1:3000",
  password: process.env.MAILBENTO_PASSWORD || undefined,
  timeoutMs: Number(process.env.MAILBENTO_TIMEOUT_MS ?? 30000),
});

const server = new McpServer({ name: "mailbento", version: "0.1.0" });

function ok(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] };
}

function fail(e: unknown) {
  const msg =
    e instanceof MailBentoError || e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text" as const, text: msg }] };
}

const mail = (force = false) =>
  client.get<MailResponse>(`/api/mail${force ? "?force=1" : ""}`);

// ── 메일함 ──────────────────────────────────────────────────────

server.registerTool(
  "list_mailboxes",
  {
    title: "메일함 목록",
    description:
      "등록된 메일함(계정 뷰)을 나열한다. 같은 자격증명을 복제해 IMAP 쿼리만 다르게 준 " +
      "폴더·검색 뷰도 각각 하나의 메일함으로 잡힌다.",
    inputSchema: {},
  },
  async () => {
    try {
      const res = await client.get<{ accounts: Account[] }>("/api/accounts");
      return ok({
        mailboxes: res.accounts.map((a) => ({
          id: a.id,
          name: a.displayName,
          email: a.email,
          provider: a.provider,
          query: a.query,
          position: a.position,
        })),
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "list_mail",
  {
    title: "메일 목록",
    description:
      "메일함의 최근 메일을 읽는다. mailbox 를 주면 그 하나만. " +
      "기본은 서버 캐시를 쓰고, force=true 면 IMAP 을 다시 조회한다(느리다). " +
      "본문은 들어 있지 않다 — 필요하면 read_mail 로 한 통씩 연다.",
    inputSchema: {
      mailbox: z
        .string()
        .optional()
        .describe("메일함 id · 이름 · 주소 중 아무것. 없으면 전부"),
      force: z.boolean().optional().describe("캐시를 무시하고 IMAP 재조회"),
      limit: z.number().int().min(1).max(50).optional().describe("메일함당 통수"),
      unreadOnly: z.boolean().optional(),
    },
  },
  async ({ mailbox, force, limit, unreadOnly }) => {
    try {
      const res = await mail(force ?? false);
      const scope = mailbox ? [resolveInbox(res, mailbox)] : res.inboxes;
      return ok({
        cached: res.cached ?? null,
        stale: res.stale ?? null,
        mailboxes: scope.map((i) => {
          let msgs = i.messages;
          if (unreadOnly) msgs = msgs.filter((m) => m.unread);
          if (limit) msgs = msgs.slice(0, limit);
          return {
            id: i.account.id,
            name: i.account.displayName,
            unreadCount: i.unreadCount,
            error: i.error ?? null,
            messages: msgs.map(shapeMessage),
          };
        }),
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "search_mail",
  {
    title: "메일 검색",
    description:
      "제목·보낸사람·미리보기에서 문자열을 찾는다. 캐시된 목록 안에서만 찾으므로 " +
      "메일함에 보이는 최근 N통이 대상이다. 서버에서 더 넓게 찾으려면 앱에서 " +
      "IMAP 쿼리 뷰를 만드는 편이 맞다.",
    inputSchema: {
      query: z.string().min(1),
      mailbox: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().describe("기본 30"),
    },
  },
  async ({ query, mailbox, limit }) => {
    try {
      const res = await mail(false);
      const scope = mailbox ? [resolveInbox(res, mailbox)] : res.inboxes;
      const q = query.toLowerCase();
      const cap = limit ?? 30;
      const hits: unknown[] = [];
      for (const i of scope) {
        for (const m of i.messages) {
          const hay = [m.subject, m.from.name, m.from.email, m.snippet]
            .filter(Boolean)
            .join("\n")
            .toLowerCase();
          if (!hay.includes(q)) continue;
          hits.push({
            mailbox: { id: i.account.id, name: i.account.displayName },
            message: shapeMessage(m),
          });
          if (hits.length >= cap) break;
        }
        if (hits.length >= cap) break;
      }
      return ok({ query, count: hits.length, hits });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "read_mail",
  {
    title: "메일 열기",
    description:
      "메일 한 통의 본문을 읽는다. 텍스트 본문이 있으면 그것을, 없으면 HTML 에서 " +
      "태그를 벗겨 낸 것을 준다. **여는 순간 앱에서 읽음으로 표시된다** " +
      "(IMAP 서버의 상태는 바뀌지 않는다).",
    inputSchema: {
      mailboxId: z.number().int().positive(),
      messageId: z.string().min(1),
      bodyLimit: z
        .number()
        .int()
        .optional()
        .describe(`본문 최대 글자수. 기본 ${DEFAULT_BODY_LIMIT}, 0 이면 자르지 않음`),
    },
  },
  async ({ mailboxId, messageId, bodyLimit }) => {
    try {
      // 응답은 { message, flag } 로 감싸져 온다
      const res = await client.get<{ message: MailMessageDetail }>(
        `/api/mail/${mailboxId}/${encodeURIComponent(messageId)}`,
      );
      return ok(shapeDetail(res.message, bodyLimit ?? DEFAULT_BODY_LIMIT));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "set_mail_flags",
  {
    title: "읽음 · 표식",
    description:
      "앱 내부 표식만 바꾼다. IMAP 서버의 \\Seen 은 건드리지 않는다. " +
      "mark 를 null 로 주면 표식을 뗀다.",
    inputSchema: {
      mailboxId: z.number().int().positive(),
      messageId: z.string().min(1),
      read: z.boolean().optional(),
      mark: z.enum(MESSAGE_MARKS).nullable().optional(),
    },
  },
  async ({ mailboxId, messageId, read, mark }) => {
    try {
      if (read === undefined && mark === undefined) {
        throw new Error("read 나 mark 중 하나는 주어야 합니다");
      }
      await client.send(
        "PATCH",
        `/api/mail/${mailboxId}/${encodeURIComponent(messageId)}`,
        {
          ...(read !== undefined ? { read } : {}),
          ...(mark !== undefined ? { mark } : {}),
        },
      );
      return ok({ mailboxId, messageId, read, mark });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "update_mailbox",
  {
    title: "메일함 표시 고치기",
    description:
      "이름·IMAP 쿼리·표시 주소만 바꾼다. 자격증명은 다루지 않는다. " +
      "쿼리 예: 'folder:Sent', 'from:naver.com', 'unseen', 'since:2026-01-01'.",
    inputSchema: {
      mailboxId: z.number().int().positive(),
      displayName: z.string().trim().min(1).optional(),
      query: z.string().trim().nullable().optional().describe("null 이면 쿼리 해제"),
      displayEmail: z.string().trim().nullable().optional(),
    },
  },
  async ({ mailboxId, ...patch }) => {
    try {
      const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
      if (entries.length === 0) throw new Error("바꿀 항목이 없습니다");
      await client.send(
        "PATCH",
        `/api/accounts?id=${mailboxId}`,
        Object.fromEntries(entries),
      );
      const res = await client.get<{ accounts: Account[] }>("/api/accounts");
      const a = res.accounts.find((x) => x.id === mailboxId);
      return ok({ updated: a ?? null });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "reorder_mailboxes",
  {
    title: "메일함 순서",
    description: "화면에 놓이는 순서.",
    inputSchema: { orderedIds: z.array(z.number().int().positive()).min(1) },
  },
  async ({ orderedIds }) => {
    try {
      await client.send("POST", "/api/accounts/reorder", { orderedIds });
      const res = await client.get<{ accounts: Account[] }>("/api/accounts");
      return ok({
        order: res.accounts.map((a) => ({ id: a.id, name: a.displayName })),
      });
    } catch (e) {
      return fail(e);
    }
  },
);

// ── 보관함 ──────────────────────────────────────────────────────

server.registerTool(
  "list_archive",
  {
    title: "보관함 목록",
    description:
      "보관해 둔 메일 사본. 원본이 IMAP 에서 사라져도 남아 있다. " +
      "sourceAccountId 가 null 이면 원본 메일함이 지워진 사본이다.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  async ({ limit }) => {
    try {
      const res = await client.get<{ archived: ArchivedSummary[] }>("/api/archive");
      const rows = limit ? res.archived.slice(0, limit) : res.archived;
      return ok({ count: res.archived.length, archived: rows.map(shapeArchived) });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "archive_mail",
  {
    title: "메일 보관",
    description:
      "메일을 **사본째** 떠서 보관함에 넣는다 — 본문·수신인까지 복사하므로 " +
      "원본이 서버에서 사라져도 열린다. 첨부와 인라인 이미지는 보관하지 않는다. " +
      "이미 보관된 메일이면 사본을 갱신한다(순서와 보관 시각은 유지).",
    inputSchema: {
      mailboxId: z.number().int().positive(),
      messageId: z.string().min(1),
    },
  },
  async ({ mailboxId, messageId }) => {
    try {
      // { archived: 방금 뜬 사본, list: 갱신된 전체 } 로 온다
      const res = await client.send<{
        archived: ArchivedSummary;
        list: ArchivedSummary[];
      }>("POST", "/api/archive", { accountId: mailboxId, messageId });
      return ok({
        archived: res.archived ? shapeArchived(res.archived) : null,
        total: res.list?.length ?? null,
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "read_archived",
  {
    title: "보관 메일 열기",
    description:
      "보관 사본의 본문을 읽는다. IMAP 을 타지 않으므로 원본이 없어도 열린다.",
    inputSchema: {
      archiveId: z.number().int().positive().describe("list_archive 의 id"),
      bodyLimit: z.number().int().optional(),
    },
  },
  async ({ archiveId, bodyLimit }) => {
    try {
      // { message, flag, archived } 로 감싸져 온다. 사본의 표식은 flag 쪽이
      // 정본이다 — message 는 라이브 열람과 모양을 맞춘 것뿐이다.
      const res = await client.get<{
        message: MailMessageDetail;
        flag: { read: boolean; mark: string | null };
      }>(`/api/archive/${archiveId}`);
      return ok({
        ...shapeDetail(res.message, bodyLimit ?? DEFAULT_BODY_LIMIT),
        read: res.flag?.read ?? null,
        mark: res.flag?.mark ?? null,
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "set_archived_flags",
  {
    title: "보관 메일 표식",
    description:
      "보관 사본이 들고 있는 읽음·표식을 바꾼다. 원본 메일의 표식과는 별개다 — " +
      "사본은 보관 시점의 값을 복사해 자기 컬럼에 들고 있다.",
    inputSchema: {
      archiveId: z.number().int().positive(),
      read: z.boolean().optional(),
      mark: z.enum(MESSAGE_MARKS).nullable().optional(),
    },
  },
  async ({ archiveId, read, mark }) => {
    try {
      if (read === undefined && mark === undefined) {
        throw new Error("read 나 mark 중 하나는 주어야 합니다");
      }
      await client.send("PATCH", `/api/archive/${archiveId}`, {
        ...(read !== undefined ? { read } : {}),
        ...(mark !== undefined ? { mark } : {}),
      });
      return ok({ archiveId, read, mark });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "unarchive",
  {
    title: "보관 해제",
    description:
      "사본을 지운다. **되돌릴 수 없다** — 원본이 이미 서버에서 사라졌을 수 있고, " +
      "그렇다면 그 메일은 어디에도 남지 않는다.",
    inputSchema: { archiveId: z.number().int().positive() },
  },
  async ({ archiveId }) => {
    try {
      await client.send("DELETE", `/api/archive/${archiveId}`);
      return ok({ removed: archiveId, note: "사본 삭제 — 되돌릴 수 없음" });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "reorder_archive",
  {
    title: "보관함 순서",
    inputSchema: { orderedIds: z.array(z.number().int().positive()).min(1) },
  },
  async ({ orderedIds }) => {
    try {
      const res = await client.send<{ list?: ArchivedSummary[] }>(
        "POST",
        "/api/archive/reorder",
        { orderedIds },
      );
      return ok({ order: (res.list ?? []).map((a) => a.id) });
    } catch (e) {
      return fail(e);
    }
  },
);

// ── 기동 ────────────────────────────────────────────────────────

async function main() {
  await server.connect(new StdioServerTransport());
  // stdout 은 프로토콜 전용이다.
  console.error(`[mailbento-mcp] ${client.baseUrl} 에 연결 준비`);
}

main().catch((e) => {
  console.error("[mailbento-mcp] 기동 실패:", e);
  process.exit(1);
});
