"use client";

import { ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { fileToIconDataUrl } from "@/lib/image-upload";
import { cn } from "@/lib/utils";

/** 이미지 파일을 업로드해 아이콘 data URL 로 변환하고 onPicked 로 전달. */
export function IconUpload({
  onPicked,
  className,
}: {
  onPicked: (dataUrl: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        title="이미지 파일 업로드"
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-md bg-(--color-bg-2) px-2 py-1.5 text-[11px] text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2) disabled:opacity-50",
          className,
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ImagePlus className="h-3.5 w-3.5" />
        )}
        업로드
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            onPicked(await fileToIconDataUrl(f));
          } catch {
            /* 무시 */
          } finally {
            setBusy(false);
            if (ref.current) ref.current.value = "";
          }
        }}
      />
    </>
  );
}
