"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function DeleteAccountButton({
  id,
  email,
}: {
  id: number;
  email: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="grid h-8 w-8 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-2) hover:text-(--color-danger)"
        aria-label={`${email} 연결 해제`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    );
  }

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
        {pending ? "삭제 중…" : "확인"}
      </button>
    </div>
  );
}
