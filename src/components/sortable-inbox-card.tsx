"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { InboxCard, type InboxCardData } from "./inbox-card";

export function SortableInboxCard({
  data,
  onFlagsChanged,
}: {
  data: InboxCardData;
  onFlagsChanged?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: data.account.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : "auto",
  };

  // role / tabIndex 는 넘기지 않는다. 손잡이가 머리말이라, 버튼과 링크를 품은
  // <header> 에 role="button" 을 씌우면 그 안의 것들이 보조기술에서 묻힌다.
  const { role: _role, tabIndex: _tabIndex, ...dragAria } = attributes;

  return (
    <div ref={setNodeRef} style={style}>
      <InboxCard
        data={data}
        onFlagsChanged={onFlagsChanged}
        headerDragProps={
          { ...dragAria, ...listeners } as unknown as React.HTMLAttributes<HTMLElement>
        }
      />
    </div>
  );
}
