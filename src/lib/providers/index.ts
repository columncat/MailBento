import type { Provider } from "../db/schema";
import { gmailProvider } from "./gmail";
import { imapProvider } from "./imap";
import { outlookProvider } from "./outlook";
import { outlookImapProvider } from "./outlook-imap";
import type { MailProvider } from "./types";

const PROVIDERS: Partial<Record<Provider, MailProvider>> = {
  gmail: gmailProvider,
  outlook: outlookProvider,
  outlook_imap: outlookImapProvider,
  // Naver 와 generic IMAP 은 같은 어댑터 (basic auth + app password)
  naver: imapProvider,
  imap: imapProvider,
};

export function getProvider(provider: Provider): MailProvider {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`${provider} 어댑터가 아직 구현되지 않았습니다.`);
  return p;
}

export function isProviderImplemented(provider: Provider): boolean {
  return Boolean(PROVIDERS[provider]);
}
