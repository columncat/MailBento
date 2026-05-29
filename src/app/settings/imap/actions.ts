"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { encrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { testImapConnection } from "@/lib/providers/imap";

const formSchema = z.object({
  displayName: z.string().trim().min(1, "표시 이름이 필요합니다"),
  email: z.string().trim().email("올바른 이메일 형식이 아닙니다"),
  host: z.string().trim().min(1, "IMAP 호스트가 필요합니다"),
  port: z.coerce.number().int().positive().max(65535),
  username: z.string().trim().min(1, "사용자명이 필요합니다"),
  password: z.string().min(1, "비밀번호가 필요합니다"),
});

export type ImapFormState = { error?: string } | null;

export async function saveImapAccount(
  _prev: ImapFormState,
  formData: FormData,
): Promise<ImapFormState> {
  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => i.message).join(" · "),
    };
  }

  const { displayName, email, host, port, username, password } = parsed.data;

  try {
    await testImapConnection({ host, port, user: username, pass: password });
  } catch (err) {
    return {
      error: `IMAP 접속 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
    };
  }

  const all = await db
    .select({ position: schema.accounts.position })
    .from(schema.accounts)
    .all();
  const maxPos = all.reduce((m, r) => Math.max(m, r.position), -1);

  await db
    .insert(schema.accounts)
    .values({
      provider: "imap",
      displayName,
      email,
      imapHost: host,
      imapPort: port,
      imapUsername: username,
      imapPasswordEnc: encrypt(password),
      position: maxPos + 1,
      updatedAt: new Date(),
    })
    .run();

  redirect("/");
}
