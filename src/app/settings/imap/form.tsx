"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";

import { saveImapAccount, type ImapFormState } from "./actions";

interface Preset {
  label: string;
  host: string;
  port: number;
  emailPlaceholder: string;
}

const PRESETS: Record<string, Preset> = {
  custom: {
    label: "직접 입력",
    host: "",
    port: 993,
    emailPlaceholder: "you@example.com",
  },
  naver: {
    label: "Naver Mail",
    host: "imap.naver.com",
    port: 993,
    emailPlaceholder: "myname@naver.com",
  },
  icloud: {
    label: "iCloud Mail",
    host: "imap.mail.me.com",
    port: 993,
    emailPlaceholder: "name@icloud.com",
  },
  yandex: {
    label: "Yandex Mail",
    host: "imap.yandex.com",
    port: 993,
    emailPlaceholder: "name@yandex.com",
  },
  fastmail: {
    label: "Fastmail",
    host: "imap.fastmail.com",
    port: 993,
    emailPlaceholder: "name@fastmail.com",
  },
  daum: {
    label: "Daum Mail",
    host: "imap.daum.net",
    port: 993,
    emailPlaceholder: "name@daum.net",
  },
  gmx: {
    label: "GMX",
    host: "imap.gmx.com",
    port: 993,
    emailPlaceholder: "name@gmx.com",
  },
  office365: {
    label: "Office 365 (앱 비밀번호 가능 시)",
    host: "outlook.office365.com",
    port: 993,
    emailPlaceholder: "you@org.com",
  },
};

export function ImapForm() {
  const [state, action, pending] = useActionState<ImapFormState, FormData>(
    saveImapAccount,
    null,
  );
  const [presetKey, setPresetKey] = useState<keyof typeof PRESETS>("custom");
  const [host, setHost] = useState(PRESETS.custom.host);
  const [port, setPort] = useState<number>(PRESETS.custom.port);

  const preset = PRESETS[presetKey];

  const onChangePreset = (key: string) => {
    const k = key as keyof typeof PRESETS;
    setPresetKey(k);
    setHost(PRESETS[k].host);
    setPort(PRESETS[k].port);
  };

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="서비스">
        <select
          value={presetKey}
          onChange={(e) => onChangePreset(e.target.value)}
          className={inputCls}
        >
          {Object.entries(PRESETS).map(([key, p]) => (
            <option key={key} value={key}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="표시 이름">
        <input
          name="displayName"
          required
          placeholder={
            presetKey === "naver"
              ? "내 Naver"
              : presetKey === "icloud"
                ? "My iCloud"
                : "Work Mail"
          }
          className={inputCls}
        />
      </Field>

      <Field label="이메일">
        <input
          name="email"
          type="email"
          required
          placeholder={preset.emailPlaceholder}
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-[1fr_140px] gap-3">
        <Field label="IMAP 호스트">
          <input
            name="host"
            required
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="imap.example.com"
            className={inputCls}
          />
        </Field>
        <Field label="포트">
          <input
            name="port"
            type="number"
            required
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="사용자명">
        <input
          name="username"
          required
          placeholder={preset.emailPlaceholder}
          className={inputCls}
        />
      </Field>

      <Field label="앱 비밀번호">
        <input
          name="password"
          type="password"
          required
          autoComplete="off"
          className={inputCls}
        />
      </Field>

      {state?.error && (
        <div className="flex items-start gap-2 rounded-lg bg-(--color-danger)/10 px-3 py-2.5 text-xs text-(--color-danger) ring-1 ring-(--color-danger)/30">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 flex items-center justify-center gap-2 rounded-full bg-(--color-accent) px-5 py-2.5 text-sm font-medium text-(--color-bg) hover:bg-(--color-accent-strong) disabled:opacity-50"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? "접속 확인 중…" : "연결 + 저장"}
      </button>
    </form>
  );
}

const inputCls =
  "w-full rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-(--color-fg-2)">{label}</span>
      {children}
    </label>
  );
}
