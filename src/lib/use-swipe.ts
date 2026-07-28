"use client";

import { useRef, useState } from "react";

/** 이만큼 끌면 놓았을 때 동작이 일어난다. */
const COMMIT_PX = 72;
/** 이만큼 움직여야 "가로로 끄는 중"으로 본다. 손떨림과 세로 스크롤을 걸러낸다. */
const START_PX = 10;

/**
 * 좌우 스와이프.
 *
 * 목록 항목은 세로로 스크롤되는 자리에 있어서, 가로 의도가 분명해질 때까지는
 * 아무것도 하지 않고 브라우저에 스크롤을 맡긴다. 세로가 먼저 크게 움직이면
 * 그 제스처는 아예 포기한다 — 스크롤 중에 항목이 밀려나면 놀란다.
 *
 * 놓은 뒤 곧바로 click 이 뒤따르므로, 끌었던 제스처였다면 그 click 한 번을
 * 삼킨다. 그러지 않으면 스와이프할 때마다 메일이 함께 열린다.
 */
export function useSwipe(onCommit: (direction: -1 | 1) => void) {
  // 판단은 ref 로 한다. state 는 그리기용이라 리렌더 뒤에야 갱신되는데,
  // 빠르게 튕기면 pointerup 이 그보다 먼저 와서 끌린 거리를 0 으로 읽는다 —
  // 그러면 손은 크게 밀었는데 아무 일도 일어나지 않는다.
  const dxRef = useRef(0);
  const [dx, setDx] = useState(0);
  const [active, setActive] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const decided = useRef<"none" | "horizontal" | "abandoned">("none");
  const swallowClick = useRef(false);

  const reset = () => {
    start.current = null;
    decided.current = "none";
    dxRef.current = 0;
    setDx(0);
    setActive(false);
  };

  return {
    /** 지금 끌려 있는 거리(px). 화면을 미는 데 쓴다. */
    dx,
    /** 놓으면 동작이 일어날 만큼 끌렸는가. */
    armed: Math.abs(dx) >= COMMIT_PX,
    active,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        // 마우스는 왼쪽 버튼만. 펜·터치는 그대로 받는다.
        if (e.pointerType === "mouse" && e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY };
        decided.current = "none";
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = start.current;
        if (!s || decided.current === "abandoned") return;
        const mx = e.clientX - s.x;
        const my = e.clientY - s.y;

        if (decided.current === "none") {
          if (Math.abs(mx) < START_PX && Math.abs(my) < START_PX) return;
          if (Math.abs(my) > Math.abs(mx)) {
            decided.current = "abandoned";
            return;
          }
          decided.current = "horizontal";
          setActive(true);
          // 손가락을 놓칠 때 항목이 밀린 채로 굳지 않게 포인터를 붙잡는다
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }
        dxRef.current = mx;
        setDx(mx);
      },
      onPointerUp: () => {
        if (decided.current === "horizontal") {
          swallowClick.current = true;
          const moved = dxRef.current;
          if (Math.abs(moved) >= COMMIT_PX) onCommit(moved < 0 ? -1 : 1);
        }
        reset();
      },
      onPointerCancel: reset,
      onClickCapture: (e: React.MouseEvent) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    },
  };
}
