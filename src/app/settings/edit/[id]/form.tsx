"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconUpload } from "@/components/icon-upload";
import { ProviderIcon } from "@/components/provider-icon";

interface Props {
  id: number;
  initialDisplayName: string;
  initialQuery: string | null;
  initialIconUrl: string | null;
  initialDisplayEmail: string | null;
  initialWebUrl: string | null;
  realEmail: string;
}

const IMAP_QUERY_EXAMPLES: { label: string; q: string }[] = [
  { label: "특정 발신자", q: "from:boss@company.com" },
  { label: "제목 포함", q: "subject:세금계산서" },
  { label: "안 읽음만", q: "unseen" },
  { label: "특정 폴더", q: "folder:보낸메일함" },
  { label: "날짜 이후", q: "since:2026-01-01" },
];

export function EditAccountForm({
  id,
  initialDisplayName,
  initialQuery,
  initialIconUrl,
  initialDisplayEmail,
  initialWebUrl,
  realEmail,
}: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [iconUrl, setIconUrl] = useState(initialIconUrl ?? "");
  const [displayEmail, setDisplayEmail] = useState(initialDisplayEmail ?? "");
  const [webUrl, setWebUrl] = useState(initialWebUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          query: query.trim() || null,
          iconUrl: iconUrl.trim() || null,
          displayEmail: displayEmail.trim() || null,
          webUrl: webUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "저장 실패" }));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.push("/settings");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSave} className="flex flex-col gap-4">
      {/* 미리보기 */}
      <div className="rounded-xl bg-(--color-bg-2) p-4 ring-1 ring-(--color-border-soft)">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-(--color-fg-4)">
          카드 헤더 미리보기
        </div>
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-(--color-surface) ring-1 ring-(--color-border)">
            <ProviderIcon overrideUrl={iconUrl.trim() || null} size={32} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-(--color-fg)">
              {displayName || "(표시 이름)"}
            </div>
            <div className="truncate text-xs text-(--color-fg-4)">
              {displayEmail.trim() || realEmail}
            </div>
          </div>
        </div>
      </div>

      <Field label="표시 이름" hint="카드 헤더에 보일 이름">
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          className={inputCls}
        />
      </Field>

      <Field
        label="표시 이메일"
        hint={`비워두면 실제 이메일 (${realEmail}) 이 표시됩니다. 표시 전용 — 메일 가져오기엔 영향 없음.`}
      >
        <input
          value={displayEmail}
          onChange={(e) => setDisplayEmail(e.target.value)}
          placeholder={realEmail}
          className={inputCls}
        />
      </Field>

      <Field
        label="아이콘 URL / 업로드"
        hint="비워두면 기본 메일 아이콘. URL 입력 또는 이미지 파일 업로드(자동 축소)."
      >
        <div className="flex gap-2">
          <input
            value={iconUrl}
            onChange={(e) => setIconUrl(e.target.value)}
            placeholder="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/protonmail.svg"
            className={`${inputCls} min-w-0 flex-1 font-mono text-[11.5px]`}
          />
          <IconUpload onPicked={(dataUrl) => setIconUrl(dataUrl)} />
        </div>
      </Field>

      <Field
        label="바로가기 링크"
        hint="카드 우측 상단 아이콘 클릭 시 새 탭에서 열림. 비워두면 provider 기본 웹메일 URL."
      >
        <input
          value={webUrl}
          onChange={(e) => setWebUrl(e.target.value)}
          placeholder="https://mail.google.com/mail/u/1/"
          className={`${inputCls} font-mono text-[11.5px]`}
        />
      </Field>

      {
        <Field
          label="IMAP 폴더/검색 쿼리"
          hint="비워두면 받은편지함(INBOX). 채우면 이 박스는 해당 결과만 보여줌."
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="(비워두면 INBOX 기본)"
            className={`${inputCls} font-mono`}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {IMAP_QUERY_EXAMPLES.map((ex) => (
              <button
                key={ex.q}
                type="button"
                onClick={() => setQuery(ex.q)}
                className="rounded-full bg-(--color-bg-2) px-2.5 py-1 text-[10.5px] text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
                title={ex.q}
              >
                {ex.label}
              </button>
            ))}
          </div>
          {
            <p className="mt-2 text-[10.5px] leading-relaxed text-(--color-fg-4)">
              토큰(공백 = AND):{" "}
              <code className="text-(--color-fg-3)">folder:</code>{" "}
              <code className="text-(--color-fg-3)">from:</code>{" "}
              <code className="text-(--color-fg-3)">to:</code>{" "}
              <code className="text-(--color-fg-3)">subject:</code>{" "}
              <code className="text-(--color-fg-3)">text:</code>{" "}
              <code className="text-(--color-fg-3)">since:YYYY-MM-DD</code>{" "}
              <code className="text-(--color-fg-3)">before:</code>{" "}
              <code className="text-(--color-fg-3)">unseen</code>/
              <code className="text-(--color-fg-3)">seen</code>. 공백 포함 값은{" "}
              {'"따옴표"'}. 예: <code>folder:보낸메일함 from:naver.com unseen</code>
            </p>
          }
        </Field>
      }

      {error && (
        <div className="rounded-lg bg-(--color-danger)/10 px-3 py-2 text-xs text-(--color-danger) ring-1 ring-(--color-danger)/30">
          {error}
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push("/settings")}
          className="rounded-full bg-(--color-bg-2) px-4 py-2 text-sm text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-full bg-(--color-accent) px-5 py-2 text-sm font-medium text-(--color-bg) hover:bg-(--color-accent-strong) disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-(--color-fg-2)">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-(--color-fg-4)">{hint}</span>}
    </label>
  );
}
