import type { Account, Provider } from "../db/schema";

export type { Provider };

export interface MailMessage {
  /** 제공자 고유 메시지 ID. */
  id: string;
  subject: string;
  from: {
    name: string | null;
    email: string;
  };
  /** 메일 수신 시각 (unix ms). */
  receivedAt: number;
  /** 본문 미리보기 (제공자가 주는 경우만). */
  snippet: string | null;
  unread: boolean;
}

export interface MailAddress {
  name: string | null;
  email: string;
}

export interface MailMessageDetail extends MailMessage {
  to: MailAddress[];
  cc: MailAddress[];
  /** sanitized HTML 본문 (없으면 null). */
  html: string | null;
  /** plain text 본문 (없으면 null). */
  text: string | null;
}

export interface InboxFetchResult {
  account: Pick<
    Account,
    | "id"
    | "provider"
    | "displayName"
    | "email"
    | "iconUrl"
    | "displayEmail"
    | "webUrl"
  >;
  messages: MailMessage[];
  unreadCount: number | null;
  /** 가져오기 실패 시 사용자에게 보여줄 사유. */
  error: string | null;
}

export interface MailProvider {
  /** 받은편지함의 최신 메일 N개를 가져온다. */
  fetchInbox(account: Account, limit: number): Promise<MailMessage[]>;
  /** 안 읽음 개수. 제공자가 효율적으로 줄 수 있으면 구현, 아니면 null. */
  fetchUnreadCount?(account: Account): Promise<number | null>;
  /** 메일 한 통의 본문을 가져온다 (열람 전용). */
  fetchMessage(account: Account, messageId: string): Promise<MailMessageDetail>;
}
