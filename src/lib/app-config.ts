import { eq } from "drizzle-orm";

import { db, schema } from "./db";

const ROW_ID = 1;
export const DEFAULT_MAIL_CACHE_SECONDS = 60;

export interface AppConfig {
  mailCacheSeconds: number;
}

export function getAppConfig(): AppConfig {
  const row = db
    .select()
    .from(schema.appConfig)
    .where(eq(schema.appConfig.id, ROW_ID))
    .get();
  return {
    mailCacheSeconds: row?.mailCacheSeconds ?? DEFAULT_MAIL_CACHE_SECONDS,
  };
}

export function setAppConfig(input: Partial<AppConfig>): AppConfig {
  const cur = getAppConfig();
  const next: AppConfig = {
    mailCacheSeconds: clamp(
      input.mailCacheSeconds ?? cur.mailCacheSeconds,
      0,
      3600,
    ),
  };
  db.insert(schema.appConfig)
    .values({ id: ROW_ID, mailCacheSeconds: next.mailCacheSeconds })
    .onConflictDoUpdate({
      target: schema.appConfig.id,
      set: { mailCacheSeconds: next.mailCacheSeconds, updatedAt: new Date() },
    })
    .run();
  return next;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
