"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { IconUpload } from "@/components/icon-upload";
import {
  autoIconUrl,
  uid,
  type FolderLink,
  type WidgetFolder,
} from "@/lib/widget-storage";

interface Props {
  folder: WidgetFolder | null;
  open: boolean;
  onClose: () => void;
  onSave: (folder: WidgetFolder) => void;
}

export function FolderEditor({ folder, open, onClose, onSave }: Props) {
  const [name, setName] = useState("");
  const [links, setLinks] = useState<FolderLink[]>([]);

  useEffect(() => {
    if (folder) {
      setName(folder.name);
      setLinks([...folder.links]);
    } else {
      setName("");
      setLinks([]);
    }
  }, [folder, open]);

  if (!folder) return null;

  const updateLink = (idx: number, patch: Partial<FolderLink>) => {
    setLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addLink = () => {
    if (links.length >= 4) return;
    setLinks((prev) => [...prev, { id: uid(), title: "", url: "", iconUrl: "" }]);
  };

  const removeLink = (idx: number) => {
    setLinks((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    onSave({
      ...folder,
      name: name.trim() || "(이름 없음)",
      links: links.filter((l) => l.url.trim().length > 0),
    });
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[min(640px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card)] bg-(--color-surface) ring-1 ring-(--color-border) shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-(--color-border-soft) px-6 py-4">
            <Dialog.Title asChild>
              <h2
                className="text-lg"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                폴더 편집
              </h2>
            </Dialog.Title>
            <Dialog.Close className="grid h-8 w-8 place-items-center rounded-md text-(--color-fg-3) hover:bg-(--color-surface-hi) hover:text-(--color-fg)">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">
            <Field label="폴더 이름">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: AI, Mail, Work"
                className={inputCls}
                autoFocus
              />
            </Field>

            <div className="mt-5 mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-(--color-fg-2)">
                링크 ({links.length} / 4)
              </span>
              {links.length < 4 && (
                <button
                  type="button"
                  onClick={addLink}
                  className="flex items-center gap-1 rounded-full bg-(--color-accent-soft) px-3 py-1 text-[11px] text-(--color-accent-strong) ring-1 ring-(--color-accent)/40 hover:bg-(--color-accent)/25"
                >
                  <Plus className="h-3 w-3" />
                  링크 추가
                </button>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {links.map((link, i) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  onChange={(patch) => updateLink(i, patch)}
                  onRemove={() => removeLink(i)}
                />
              ))}
              {links.length === 0 && (
                <div className="rounded-lg border border-dashed border-(--color-border) py-8 text-center text-xs text-(--color-fg-4)">
                  아직 링크가 없습니다 — "링크 추가" 로 시작하세요
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-(--color-border-soft) px-6 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-(--color-bg-2) px-4 py-1.5 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-full bg-(--color-accent) px-4 py-1.5 text-xs font-medium text-(--color-bg) hover:bg-(--color-accent-strong)"
              >
                저장
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LinkRow({
  link,
  onChange,
  onRemove,
}: {
  link: FolderLink;
  onChange: (patch: Partial<FolderLink>) => void;
  onRemove: () => void;
}) {
  const previewSrc = link.iconUrl.trim() || (link.url.trim() ? autoIconUrl(link.url) : "");
  return (
    <div className="flex gap-3 rounded-lg bg-(--color-bg-2) p-3 ring-1 ring-(--color-border-soft)">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-(--color-surface) ring-1 ring-(--color-border)">
        {previewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewSrc}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded object-contain"
          />
        ) : (
          <span className="text-[9px] text-(--color-fg-4)">아이콘</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <input
          value={link.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="제목 (예: Gmail)"
          className={inputCls + " text-[12px]"}
        />
        <input
          value={link.url}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="URL (https://...)"
          className={inputCls + " font-mono text-[11px]"}
        />
        <div className="flex gap-1.5">
          <input
            value={link.iconUrl}
            onChange={(e) => onChange({ iconUrl: e.target.value })}
            placeholder="아이콘 URL (비우면 favicon 자동) · 또는 업로드"
            className={inputCls + " min-w-0 flex-1 font-mono text-[10.5px]"}
          />
          <IconUpload onPicked={(dataUrl) => onChange({ iconUrl: dataUrl })} />
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="grid h-8 w-8 shrink-0 place-items-center self-start rounded-md text-(--color-fg-4) hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
        title="이 링크 삭제"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const inputCls =
  "w-full rounded-md bg-(--color-surface) px-2.5 py-1.5 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60";

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
