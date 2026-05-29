"use client";

import { AlertCircle, Loader2, Lock } from "lucide-react";
import { useActionState } from "react";

import { loginAction, type LoginFormState } from "./actions";

export function LoginForm({ to }: { to: string }) {
  const [state, action, pending] = useActionState<LoginFormState, FormData>(
    loginAction,
    null,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="to" value={to} />

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-(--color-fg-2)">
          비밀번호
        </span>
        <div className="relative">
          <Lock className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-(--color-fg-4)" />
          <input
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            className="w-full rounded-lg bg-(--color-bg-2) py-2.5 pr-3 pl-9 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60"
          />
        </div>
      </label>

      <label className="flex items-center gap-2 text-xs text-(--color-fg-2)">
        <input
          name="remember"
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-(--color-border) bg-(--color-bg-2) text-(--color-accent) focus:ring-(--color-accent)/60"
        />
        <span>이 기기에서 자동 로그인 (90일)</span>
      </label>

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
        {pending ? "확인 중…" : "로그인"}
      </button>

      <p className="text-center text-[10.5px] text-(--color-fg-4)">
        모든 로그인 시도는 기록됩니다 (실패 포함).
      </p>
    </form>
  );
}
