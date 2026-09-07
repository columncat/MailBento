import type { Account, MessageMark, Provider } from "../db/schema";

export type { MessageMark, Provider };

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
  /**
   * 표시용 안읽음 상태 — 서버의 \Seen 에 앱 내부 "읽음 처리"를 덮어씌운 값.
   * 앱에서 읽음 처리했으면 서버가 안읽음이어도 false.
   */
  unread: boolean;
  /** 앱 내부 표식 (없으면 null / 미설정이면 undefined). */
  mark?: MessageMark | null;
  /** 보관함에 담겨 있으면 그 행 id. 목록의 보관 버튼이 토글로 동작하게 한다. */
  archiveId?: number | null;
}

export interface MailAddress {
  name: string | null;
  email: string;
}

/**
 * 메일에 딸려 온 파일 하나. **바이트는 들어 있지 않다.**
 *
 * 목록만 먼저 주고, 사람이 단추를 누를 때 비로소 IMAP 에서 그 조각만 받아
 * 흘려보낸다. 수집기가 새 메일의 **본문**을 미리 받아 두게 된 뒤에도 이건
 * 그대로다 — 본문은 열면 반드시 보게 되는 것이고 캐시의 통당 상한이 1MB 지만,
 * 첨부는 열어도 안 누를 수 있는 20MB 다. 미리 끌어올 이유가 없다.
 */
export interface MailAttachment {
  /**
   * 내려받기 주소에 그대로 넣는 손잡이. **이 메일 안에서만 뜻이 있다.**
   *
   * 보통은 IMAP 이 말해 준 body part 번호("2", "1.2")다. 서버가 준 구조와
   * 파서가 본 구조가 어긋나 번호를 확신할 수 없을 때만 "i0" 같은 자리표를
   * 쓰고, 그때는 라우트가 원문을 다시 받아 그 번호째 조각을 꺼낸다.
   */
  id: string;
  /** 사람이 볼 이름. 이름을 안 붙여 보내는 첨부도 있어 null 이 온다. */
  filename: string | null;
  /**
   * 발신자가 선언한 MIME 타입. **아이콘과 설명에만 쓴다** —
   * 내려받기 응답은 이 값을 믿지 않는다(라우트 주석 참고).
   */
  contentType: string;
  /** 디코딩된 바이트 수. 서버가 인코딩된 크기만 줄 때는 어림값이다. */
  size: number | null;
}

export interface MailMessageDetail extends MailMessage {
  to: MailAddress[];
  cc: MailAddress[];
  /** sanitized HTML 본문 (없으면 null). */
  html: string | null;
  /** plain text 본문 (없으면 null). */
  text: string | null;
  /**
   * 내려받기 단추를 붙일 첨부들.
   *
   * **본문이 `cid:` 로 가리켜 이미 화면에 그려지고 있는 조각은 빠진다.**
   * 서명 이미지와 로고 조각까지 목록에 세우면 정작 받아야 할 PDF 한 개가
   * 스무 개의 그림 사이에 묻힌다. 반대로 `cid` 가 있어도 본문이 그것을 쓰지
   * 않으면 화면 어디에도 안 나오므로 목록에 남긴다 — 기준은 "인라인이라고
   * 적혀 있는가" 가 아니라 "본문이 실제로 쓰는가" 다.
   */
  attachments: MailAttachment[];
  /**
   * 요청조차 보내지 않고 막은 추적 픽셀 수.
   *
   * 브라우저도, 우리 서버도 그 주소를 부르지 않았다. 0 이면 화면에 아무 말도
   * 할 필요가 없다.
   */
  blockedTrackers: number;
  /** 서버가 대신 받아 오도록 주소를 바꾼 원격 그림 수. */
  proxiedImages: number;
}

/** 인라인 그림을 본문에 어떻게 담을지. sanitize.ts 의 InlineImageMode 와 같다. */
export interface FetchMessageOptions {
  /**
   * "link"(기본) = 우리 라우트를 가리킨다. 화면용 — 본문이 가볍다.
   * "embed" = `data:` 로 굽는다. 보관용 — 원본이 사라져도 열린다.
   */
  inlineImages?: "link" | "embed";
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
  fetchMessage(
    account: Account,
    messageId: string,
    options?: FetchMessageOptions,
  ): Promise<MailMessageDetail>;
}
