import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const PROVIDERS = [
  "gmail",
  "outlook",
  "outlook_imap",
  "naver",
  "imap",
] as const;
export type Provider = (typeof PROVIDERS)[number];

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider", { enum: PROVIDERS }).notNull(),

  /** 사용자가 보기 좋게 붙이는 이름 (e.g. "Work Gmail"). */
  displayName: text("display_name").notNull(),
  /** 실제 이메일 주소. */
  email: text("email").notNull(),

  /** OAuth (gmail, outlook) — 암호화된 토큰. */
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  /** access token expiry (unix seconds). */
  expiresAt: integer("expires_at"),

  /** IMAP (naver) — 호스트/포트/사용자/암호화된 비밀번호. */
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  imapUsername: text("imap_username"),
  imapPasswordEnc: text("imap_password_enc"),

  /**
   * Provider 별 검색 쿼리 (선택).
   * - Gmail: Gmail search syntax (e.g. "label:purdue", "from:boss@x.com is:unread")
   *   null/빈 문자열 → 기본 INBOX
   * - 다른 provider: 현재 미사용 (향후 확장 가능)
   *
   * 같은 OAuth 자격증명을 여러 "뷰" 로 보고 싶을 때 사용 — 계정 복제 후 query 만 다르게.
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
