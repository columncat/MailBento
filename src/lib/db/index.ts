import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { env } from "../env";
import * as schema from "./schema";

type DB = BetterSQLite3Database<typeof schema>;

/**
 * 지연 초기화 — DB 연결/마이그레이션은 첫 쿼리(런타임) 때 1회만 수행한다.
 * `next build` 의 page-data 수집 단계에서 모듈이 import 되어도 DB 파일을 열지 않으므로,
 * 병렬 빌드 워커가 WAL 설정(쓰기)으로 충돌해 "database is locked" 가 나던 문제를 막는다.
 */
let _db: DB | null = null;
/** VACUUM · 체크포인트처럼 드리즐 위로는 못 하는 일에만 쓰는 원본 핸들. */
let _sqlite: Database.Database | null = null;

function init(): DB {
  const dbPath = resolve(env.DATABASE_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000"); // 동시 접근 시 즉시 실패 대신 대기
  sqlite.pragma("foreign_keys = ON");
  /**
   * 지운 행의 내용을 0 으로 덮는다.
   *
   * 기본값(OFF)에서는 행을 지워도 바이트가 페이지 안에 그대로 남는다. 다른
   * 표는 계정 설정·위젯처럼 사람이 스스로 넣은 값뿐이라 신경 쓸 일이 아니었지만,
   * message_body_cache 가 생기면서 **열어 보기만 한 메일의 본문**이 파일에
   * 눌어붙게 됐다. 계정을 통째로 지워 캐시 행이 0 이 된 뒤에도 .db 를 grep 하면
   * 본문·제목·보낸사람이 그대로 나왔다. 볼륨을 백업하거나 넘기면 따라간다.
   *
   * 값을 재 봤다 (100통이 찬 캐시에 담기 = 넣기 + 한 통 축출, 300회 평균):
   * 20KB 본문 0.45ms → 0.47ms, 200KB 13.8ms → 14.4ms, 상한에 가까운 900KB
   * 60.2ms → 65.0ms. 최악에서도 +8%(≈5ms)이고, 쓰기는 사람이 메일을 열 때만
   * 일어난다. 무시할 만하다.
   *
   * 이미 파일에 눌어붙은 것은 이걸로 지워지지 않는다 — 그건 VACUUM 몫이다.
   */
  sqlite.pragma("secure_delete = ON");

  _sqlite = sqlite;
  const drizzleDb = drizzle(sqlite, { schema });

  try {
    const migrationsFolder =
      process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), "drizzle");
    migrate(drizzleDb, { migrationsFolder });
  } catch (err) {
    console.error("[mailbento] migration failed:", err);
  }

  return drizzleDb;
}

function getDb(): DB {
  // Node 는 단일 스레드 + init() 은 동기이므로 경쟁 조건 없음.
  if (!_db) _db = init();
  return _db;
}

function rawSqlite(): Database.Database {
  getDb(); // 연결/마이그레이션 보장
  if (!_sqlite) throw new Error("sqlite handle not initialized");
  return _sqlite;
}

/** DB 가 디스크에서 실제로 차지하는 바이트 (.db + -wal + -shm). */
export function databaseFileBytes(): number {
  const base = resolve(env.DATABASE_PATH);
  let total = 0;
  for (const f of [base, `${base}-wal`, `${base}-shm`]) {
    try {
      total += statSync(f).size;
    } catch {
      // 아직 없는 파일(-wal 은 체크포인트 뒤 사라진다)은 0
    }
  }
  return total;
}

/**
 * 지운 자리를 **파일에서** 돌려받는다. 지운 뒤의 크기를 함께 준다.
 *
 * 행을 지워도 SQLite 파일은 줄지 않는다 — 빈 페이지가 다음 쓰기를 위해 그대로
 * 남는다(auto_vacuum 이 NONE 이라서). 재 봤다: 900KB 짜리 본문 300통을 열어
 * 87MB 가 된 파일은 표를 통째로 비워도 87MB 그대로였고, VACUUM 뒤 0.3MB 가
 * 됐다. 계정·위젯이 몇십 KB 인 사람의 mailbento.db 가 영구히 그 크기로 남는 것.
 *
 * auto_vacuum 을 켜는 길도 있지만 **이미 만들어진 DB 에서는 VACUUM 없이 안
 * 바뀐다.** 그러면 모든 기존 설치가 첫 실행에서 파일 전체를 다시 쓰게 된다 —
 * 사람이 누르지도 않은 일로. 그래서 켜지 않고, 사람이 "비우기"를 누른 그
 * 자리에서만 판다.
 *
 * VACUUM 은 파일을 통째로 다시 쓴다 — 그동안 DB 가 잠기고(단일 사용자 앱이라
 * 그 사이 다른 요청이 있으면 busy_timeout 5초 안에서 기다린다), 옛 파일만큼의
 * 빈 디스크가 더 필요하다. 사람이 명시적으로 누른 버튼에서만 부르는 이유다.
 * 잠기는 시간은 **파일 크기가 아니라 남길 자료의 양**을 따른다: 87MB 를 0.3MB
 * 로 줄일 때 13ms, 보관함 54MB 를 남기고 팔 때 407ms 였다.
 *
 * WAL 이라 앞뒤로 체크포인트를 친다. 앞은 아직 .db 에 안 내려간 변경을
 * 내리려고, 뒤는 VACUUM 결과가 WAL 에만 있으면 .db 가 안 줄어들기 때문이다
 * (지운 본문의 잔류물도 그때까지 -wal 에 남는다).
 */
/**
 * WAL 을 `.db` 로 밀어 넣고 **파일을 잘라 낸다.**
 *
 * `secure_delete` 가 못 미치는 자리를 메운다 — 지운 행의 바이트는 `-wal` 에
 * 평문으로 남고, 그 파일을 실제로 비우는 것은 TRUNCATE 체크포인트뿐이다.
 * (`journal_size_limit` 은 안 듣는다. 재 봤다.)
 *
 * 값이 든다 — WAL 을 통째로 다시 쓴다. 자주 부르지 마라.
 */
export function checkpointWal(): void {
  rawSqlite().pragma("wal_checkpoint(TRUNCATE)");
}

export function reclaimDiskSpace(): { before: number; after: number } {
  const sqlite = rawSqlite();
  const before = databaseFileBytes();
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  sqlite.exec("VACUUM"); // 트랜잭션 안에서는 부를 수 없다
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  return { before, after: databaseFileBytes() };
}

/** import 시점엔 연결하지 않고, 실제 사용(프로퍼티 접근) 때 초기화하는 프록시. */
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
}) as DB;

export { schema };
