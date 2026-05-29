"use client";

import { useState } from "react";

import { ensureFolders, type WidgetFolder } from "@/lib/widget-storage";

import { WidgetFolderCard } from "./widget-folder";
import { FolderEditor } from "./widget-folder-editor";

interface Props {
  folders: WidgetFolder[];
  onChange: (folders: WidgetFolder[]) => void;
  /** 폴더 한 변 길이(px) — 헤더 높이와 동일. 미지정이면 자동. */
  size?: number;
}

export function WidgetFoldersWing({ folders, onChange, size }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  // 항상 정확히 3개 (추가/삭제 불가).
  const fixed = ensureFolders(folders);

  const saveFolder = (updated: WidgetFolder) => {
    onChange(fixed.map((f) => (f.id === updated.id ? updated : f)));
  };

  const editing = fixed.find((f) => f.id === editingId) ?? null;

  return (
    <div
      className={
        size
          ? "flex h-full items-stretch gap-4"
          : "grid grid-cols-3 gap-4"
      }
    >
      {fixed.map((folder) => (
        <WidgetFolderCard
          key={folder.id}
          folder={folder}
          onEdit={() => setEditingId(folder.id)}
          size={size}
        />
      ))}

      <FolderEditor
        folder={editing}
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        onSave={saveFolder}
      />
    </div>
  );
}
