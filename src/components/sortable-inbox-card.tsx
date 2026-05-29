"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { InboxCard, type InboxCardData } from "./inbox-card";

export function SortableInboxCard({ data }: { data: InboxCardData }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: data.account.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : "auto",
    touchAction: "none",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <InboxCard data={data} />
    </div>
  );
}
