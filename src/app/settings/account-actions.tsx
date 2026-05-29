"use client";

import { Copy, Loader2, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  id: number;
  email: string;
  /** Gmail 같이 "뷰 복제" 가 의미있는 provider 만 true. */
  canDuplicate: boolean;
}

export function AccountActions({ id, email, canDuplicate }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [duplicating, setDuplicating] = useState(false);

  const onDuplicate = async () => {
    setDuplicating(true);
    try {
      const res = await fetch(`/api/accounts/${id}/duplicate`, {
        method: "POST",
      });
      const json = (await res.json()) as { id?: number; error?: string };
      if (json.id) router.push(`/settings/edit/${json.id}`);
    } finally {
      setDuplicating(false);
    }
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-md px-2 py-1 text-xs text-(--color-fg-3) hover:bg-(--color-surface-2)"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await fetch(`/api/accounts?id=${id}`, { method: "DELETE" });
              router.refresh();
            })
          }
          className="rounded-md bg-(--color-danger)/20 px-2 py-1 text-xs text-(--color-danger) ring-1 ring-(--color-danger)/40 hover:bg-(--color-danger)/30 disabled:opacity-50"
        >
          {pending ? "삭제 중…" : "삭제 확인"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <a
        href={`/settings/edit/${id}`}
        className="grid h-8 w-8 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-2) hover:text-(--color-fg-2)"
        aria-label="편집"
        title="편집"
      >
        <Pencil className="h-3.5 w-3.5" />
      </a>
      {canDuplicate && (
        <button
          type="button"
          onClick={onDuplicate}
          disabled={duplicating}
          className="grid h-8 w-8 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-2) hover:text-(--color-fg-2) disabled:opacity-50"
          aria-label="이 계정의 다른 뷰 복제"
          title="이 계정의 다른 뷰 복제"
        >
          {duplicating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="grid h-8 w-8 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-2) hover:text-(--color-danger)"
        aria-label={`${email} 연결 해제`}
        title="삭제"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
