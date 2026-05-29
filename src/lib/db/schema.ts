import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// IMAP 단일 provider (앱 비밀번호 기반). OAuth 계열은 모두 제거됨.
export const PROVIDERS = ["imap"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider", { enum: PROVIDERS }).notNull().default("imap"),

  /** 카드 헤더에 보일 이름. */
  displayName: text("display_name").notNull(),
  /** 실제 이메일 주소. */
  email: text("email").notNull(),

  /** IMAP — 호스트/포트/사용자/암호화된 (앱) 비밀번호. */
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  imapUsername: text("imap_username"),
  imapPasswordEnc: text("imap_password_enc"),

  /**
   * IMAP "뷰" 쿼리 (선택) — 폴더 선택 + 서버 SEARCH.
   * 예: "folder:보낸메일함 from:naver.com unseen". 비우면 INBOX 최신.
   * 계정 복제 후 query 만 다르게 주면 같은 메일함의 여러 뷰를 만들 수 있음.
   */
  query: text("query"),

  /** 카드 헤더의 표시 항목 override (null 이면 provider 기본값). */
  iconUrl: text("icon_url"),
  displayEmail: text("display_email"),
  webUrl: text("web_url"),

  /** 대시보드 그리드 위치 (낮은 숫자가 앞). */
  position: integer("position").notNull().default(0),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

/** 로그인 기록 — INSERT 전용 (앱에 DELETE 엔드포인트 없음). */
export const loginLog = sqliteTable("login_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  /** "manual" = 비밀번호 입력 로그인, "auto" = remember 쿠키로 자동 로그인. */
  type: text("type", { enum: ["manual", "auto"] }).notNull(),
  /** 0 = 실패 (비번 틀림 등), 1 = 성공. */
  success: integer("success").notNull(),
  userAgent: text("user_agent"),
});

export type LoginLog = typeof loginLog.$inferSelect;

/**
 * 위젯 데이터 (폴더 / 코크보드 핀 / 메모) — 단일 행(id=1) JSON 저장.
 * 단일 사용자 가정이므로 전역 1행으로 서버 차원에서 동기화한다.
 */
export const widgetState = sqliteTable("widget_state", {
  id: integer("id").primaryKey(),
  /** WidgetState JSON 문자열. */
  data: text("data").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type WidgetStateRow = typeof widgetState.$inferSelect;
