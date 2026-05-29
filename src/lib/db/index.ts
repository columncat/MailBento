import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { env } from "../env";
import * as schema from "./schema";

const dbPath = resolve(env.DATABASE_PATH);
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };

/**
 * 서버 부팅 시 마이그레이션 자동 적용 — 빈 DB(신규 배포)에서도 테이블 생성.
 * 이 모듈은 Node 런타임(RSC/route handler)에서만 로드되며 edge 에는 포함되지 않는다.
 * 빌드 단계(phase-production-build)에서는 건너뛴다.
 */
if (process.env.NEXT_PHASE !== "phase-production-build") {
  try {
    const migrationsFolder =
      process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), "drizzle");
    migrate(db, { migrationsFolder });
  } catch (err) {
    console.error("[mailbento] migration failed:", err);
  }
}
