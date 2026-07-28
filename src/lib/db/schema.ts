import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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

/** 앱 전역 설정 — 단일 행(id=1). 서버 사이드에서 읽는 값. */
export const appConfig = sqliteTable("app_config", {
  id: integer("id").primaryKey(),
  /** 메일 서버 캐시 TTL(초). 0 = 캐시 없음. */
  mailCacheSeconds: integer("mail_cache_seconds").notNull().default(60),
  /** 대시보드 자동 새로고침 주기(초). */
  refreshIntervalSeconds: integer("refresh_interval_seconds")
    .notNull()
    .default(180),
  /** 1 = interval 도달 시 캐시 무시(force)하고 항상 새로 fetch. */
  forceOnInterval: integer("force_on_interval").notNull().default(0),
  /**
   * 시계 위젯에 띄울 지역 목록 JSON.
   *
   * 개수가 정해지지 않아 컬럼으로 쪼갤 수 없고, 값도 서로 묶여 다닌다.
   * 비어 있으면 기본 지역(서울)을 쓴다.
   */
  regions: text("regions"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type AppConfigRow = typeof appConfig.$inferSelect;

/**
 * 메일에 붙이는 앱 내부 표식.
 * IMAP 서버의 \Seen / \Flagged 를 건드리지 않고 MailBento 안에서만 관리한다
 * (메일함 상태를 바꾸지 않으므로 다른 클라이언트에 영향 없음).
 */
export const MESSAGE_MARKS = [
  "star",
  "circle",
  "triangle",
  "cross",
  "exclaim",
  "check",
] as const;
export type MessageMark = (typeof MESSAGE_MARKS)[number];

export const messageFlags = sqliteTable(
  "message_flags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** provider 고유 메시지 ID (IMAP UID 등). */
    messageId: text("message_id").notNull(),
    /** 1 = 앱에서 읽음 처리됨. 서버의 \Seen 과는 별개. */
    read: integer("read").notNull().default(0),
    /** 표식 (없으면 null). */
    mark: text("mark", { enum: MESSAGE_MARKS }),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    uniq: uniqueIndex("message_flags_account_message_idx").on(
      t.accountId,
      t.messageId,
    ),
  }),
);

export type MessageFlagRow = typeof messageFlags.$inferSelect;

/**
 * 보관함 — 메일함 카드에서 "보관"한 메일의 **사본**.
 *
 * 참조만 담지 않는 이유: IMAP UID 는 메일이 지워지거나 UIDVALIDITY 가 바뀌면
 * 더 이상 같은 메일을 가리키지 않는다. 그래서 모달이 그리는 값
 * (MailMessageDetail) 을 통째로 떠 온다 — 원본이 서버에서 사라져도 그대로 열린다.
 *
 * 첨부는 보관하지 않는다. MailMessageDetail 에 첨부 필드가 없고 imap 구현도
 * parsed.attachments 를 읽지 않는다. 본문의 cid: 이미지는 지금도 깨진 채로
 * 보이며, 보관하면 그 상태가 그대로 굳는다.
 */
export const archivedMessages = sqliteTable(
  "archived_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * 보관 당시의 메일함(=뷰) row.
     *
     * message_flags 와 달리 cascade 가 아니다. accounts 는 메일함이 아니라
     * "뷰"라 복제로 늘어나고, 무엇보다 백업 불러오기가 전 계정을 지운다
     * (api/import). cascade 였다면 "백업 복원 = 보관함 전멸"이 된다.
     */
    sourceAccountId: integer("source_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    /** 계정 행이 사라진 뒤에도 어디서 온 메일인지 보여주려고 떠 두는 값. */
    sourceLabel: text("source_label").notNull(),
    sourceEmail: text("source_email").notNull().default(""),
    sourceIconUrl: text("source_icon_url"),
    /** 원본 IMAP UID — 되돌아가 볼 때의 힌트일 뿐, 사본의 정체성은 아니다. */
    sourceMessageId: text("source_message_id").notNull(),

    // ── MailMessageDetail 사본 ──
    subject: text("subject").notNull(),
    fromName: text("from_name"),
    fromEmail: text("from_email").notNull().default(""),
    /** MailAddress[] JSON. 주소는 개수가 정해지지 않아 컬럼으로 쪼갤 수 없다. */
    toJson: text("to_json").notNull().default("[]"),
    ccJson: text("cc_json").notNull().default("[]"),
    /**
     * 수신 시각 (unix **ms**).
     * MailMessage.receivedAt 이 ms 라 Date 로 바꿨다 되돌리지 않고 그대로 담는다.
     * mode:"timestamp" 는 초 단위라 ms 가 잘린다.
     */
    receivedAt: integer("received_at").notNull(),
    snippet: text("snippet"),
    /** 보관 시점에 이미 sanitize 된 HTML. 꺼낼 때 다시 정제하지 않는다. */
    html: text("html"),
    text: text("text"),
    /** 1 = 상한을 넘어 본문이 잘렸음. */
    truncated: integer("truncated").notNull().default(0),

    /** 보관 시점의 표식 스냅샷 — message_flags 는 계정과 함께 사라진다. */
    read: integer("read").notNull().default(0),
    mark: text("mark", { enum: MESSAGE_MARKS }),

    /** 보관함 안의 수동 순서 (작을수록 위). */
    position: integer("position").notNull().default(0),
    archivedAt: integer("archived_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    /**
     * 같은 메일을 두 번 담지 않게 하는 키.
     * 계정이 지워져 sourceAccountId 가 null 이 되면 SQLite 는 NULL 을 서로 다른
     * 값으로 보므로 더는 걸리지 않는다 — 원본 메일함이 없어진 뒤의 중복은
     * 막을 대상이 아니라서 그대로 둔다.
     */
    uniq: uniqueIndex("archived_messages_source_idx").on(
      t.sourceAccountId,
      t.sourceMessageId,
    ),
    posIdx: index("archived_messages_position_idx").on(t.position),
  }),
);

export type ArchivedMessageRow = typeof archivedMessages.$inferSelect;
