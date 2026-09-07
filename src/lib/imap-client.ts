import { ImapFlow } from "imapflow";

import { decrypt } from "./crypto";
import type { Account } from "./db/schema";

/**
 * IMAP 연결을 **여는** 일만 아는 가장 아래층.
 *
 * `providers/imap.ts` 에 있던 것을 그대로 꺼냈다. 왜 꺼냈나 — 연결 풀
 * (`imap-pool.ts`)이 이 셋을 필요로 하는데, 풀이 `providers/imap.ts` 를
 * 부르고 `providers/imap.ts` 가 다시 풀을 부르면 두 모듈이 서로를 물어
 * 순환 import 가 된다. 아래층을 따로 두면 화살표가 한 방향으로만 흐른다:
 *
 *   providers/imap.ts ─→ imap-pool.ts ─→ imap-client.ts
 *   mail-part.ts ──────→ imap-pool.ts ─┘
 */

export interface ImapConnectOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export function makeImapClient(opts: ImapConnectOptions): ImapFlow {
  return new ImapFlow({
    host: opts.host,
    port: opts.port,
    secure: opts.port === 993,
    auth: { user: opts.user, pass: opts.pass },
    logger: false,
    // 무한 hang 방지 — 하나의 계정이 전체 /api/mail 을 막지 않도록
    connectionTimeout: 15000, // TCP+TLS 연결
    greetingTimeout: 10000, // 서버 인사
    socketTimeout: 30000, // 유휴 소켓
  });
}

export async function withImapConnection<T>(
  opts: ImapConnectOptions,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = makeImapClient(opts);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function testImapConnection(
  opts: ImapConnectOptions,
): Promise<void> {
  await withImapConnection(opts, async () => {});
}

export function basicCredsFromAccount(account: Account): ImapConnectOptions {
  if (
    !account.imapHost ||
    !account.imapPort ||
    !account.imapUsername ||
    !account.imapPasswordEnc
  ) {
    throw new Error(
      "IMAP 자격 증명이 누락되었습니다. 계정을 다시 등록해주세요.",
    );
  }
  return {
    host: account.imapHost,
    port: account.imapPort,
    user: account.imapUsername,
    pass: decrypt(account.imapPasswordEnc),
  };
}
