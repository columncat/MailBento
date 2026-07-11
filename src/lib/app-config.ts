import { eq } from "drizzle-orm";

import { db, schema } from "./db";

const ROW_ID = 1;

export interface AppConfig {
  /** 메일 서버 캐시 TTL(초). 0 = 캐시 없음. */
  mailCacheSeconds: number;
  /** 대시보드 자동 새로고침 주기(초). */
  refreshIntervalSeconds: number;
  /** true = interval 도달 시 캐시 무시(force)하고 항상 새로 fetch. */
  forceOnInterval: boolean;
}

const DEFAULTS: AppConfig = {
  mailCacheSeconds: 60,
  refreshIntervalSeconds: 180,
  forceOnInterval: false,
};

export function getAppConfig(): AppConfig {
  const row = db
    .select()
    .from(schema.appConfig)
    .where(eq(schema.appConfig.id, ROW_ID))
    .get();
  if (!row) return DEFAULTS;
  return {
    mailCacheSeconds: row.mailCacheSeconds,
    refreshIntervalSeconds: row.refreshIntervalSeconds,
    forceOnInterval: row.forceOnInterval === 1,
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
    refreshIntervalSeconds: clamp(
      input.refreshIntervalSeconds ?? cur.refreshIntervalSeconds,
      15,
      3600,
    ),
    forceOnInterval: input.forceOnInterval ?? cur.forceOnInterval,
  };
  db.insert(schema.appConfig)
    .values({
      id: ROW_ID,
      mailCacheSeconds: next.mailCacheSeconds,
      refreshIntervalSeconds: next.refreshIntervalSeconds,
      forceOnInterval: next.forceOnInterval ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: schema.appConfig.id,
      set: {
        mailCacheSeconds: next.mailCacheSeconds,
        refreshIntervalSeconds: next.refreshIntervalSeconds,
        forceOnInterval: next.forceOnInterval ? 1 : 0,
        updatedAt: new Date(),
      },
    })
    .run();
  return next;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
