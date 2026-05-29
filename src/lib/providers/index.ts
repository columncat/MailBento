import type { Provider } from "../db/schema";
import { imapProvider } from "./imap";
import type { MailProvider } from "./types";

// IMAP 단일 provider (앱 비밀번호 기반).
const PROVIDERS: Record<Provider, MailProvider> = {
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
