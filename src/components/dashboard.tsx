"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import {
  LayoutDashboard,
  Mail,
  RefreshCw,
  Settings as SettingsIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Provider } from "@/lib/db/schema";
import {
  COLUMN_CLASS,
  DEFAULT_COLUMNS,
  STORAGE_KEYS,
  type ColumnsPref,
} from "@/lib/preferences";
import type { InboxFetchResult, MailMessage } from "@/lib/providers/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  loadWidgetState,
  type Memo,
  type Pin,
  type WidgetFolder,
  type WidgetState,
} from "@/lib/widget-storage";

import { AgentChat } from "./agent-chat";
import { MemoBentoLink } from "./cross-app-link";
import { InboxCard } from "./inbox-card";
import { SortableInboxCard } from "./sortable-inbox-card";
import { WidgetFoldersWing } from "./widget-folders-wing";
import { WidgetHeader } from "./widget-header";
import { WidgetSideWing } from "./widget-side-wing";
import type { ArchivedSummary } from "@/lib/archive-server";
import type { RegionInput } from "@/lib/regions";
import { MessageModal } from "./message-modal";
import { apiFetch } from "@/lib/api-path";

export interface AccountSummary {
  id: number;
  provider: Provider;
  displayName: string;
  email: string;
  iconUrl: string | null;
  displayEmail: string | null;
  webUrl: string | null;
}

export interface BoxState {
  account: AccountSummary;
  loading: boolean;
  messages: MailMessage[];
  unreadCount: number | null;
  error: string | null;
}

interface MailResponse {
  inboxes: InboxFetchResult[];
  fetchedAt: number;
}

export function Dashboard({
  initialAccounts,
  initialWidgetState,
  regions,
  widgetEnabled,
  onWidgetToggle,
  memobentoUrl,
}: {
  initialAccounts: AccountSummary[];
  initialWidgetState: WidgetState;
  /** 시계 위젯 지역 (설정에서 편집). */
  regions: RegionInput[];
  widgetEnabled: boolean;
  onWidgetToggle: (v: boolean) => void;
  /** MEMOBENTO_URL override. null 이면 현재 호스트의 3001 포트로 유추. */
  memobentoUrl: string | null;
}) {
  const [boxes, setBoxes] = useState<BoxState[]>(() =>
    initialAccounts.map((a) => ({
      account: a,
      loading: true,
      messages: [],
      unreadCount: null,
      error: null,
    })),
  );
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ─ 표시 prefs: 열 개수만 대시보드에서 사용 (테마/모드는 /settings 에서) ─
  const [columns, setColumns] = useState<ColumnsPref>(DEFAULT_COLUMNS);

  // ─ 위젯 레이아웃 측정: 폴더 한 변 = 헤더 높이 ─
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerH, setHeaderH] = useState(210);
  const [isWide, setIsWide] = useState(true);

  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 1280);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const measureHeader = useCallback(() => {
    const el = headerRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    // 1px 미만 변화는 무시해 피드백 루프 방지
    setHeaderH((prev) => (h > 0 && Math.abs(prev - h) > 1 ? Math.round(h) : prev));
  }, []);

  useEffect(() => {
    if (!widgetEnabled || !isWide) return;
    // 즉시 + 다음 프레임 + 지연(폰트/날씨 로딩 후) 다중 측정으로 신뢰성 확보
    measureHeader();
    const raf = requestAnimationFrame(measureHeader);
    const t1 = setTimeout(measureHeader, 120);
    const t2 = setTimeout(measureHeader, 700);
    const el = headerRef.current;
    const ro = el ? new ResizeObserver(measureHeader) : null;
    ro?.observe(el!);
    window.addEventListener("resize", measureHeader);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      ro?.disconnect();
      window.removeEventListener("resize", measureHeader);
    };
  }, [widgetEnabled, isWide, measureHeader]);

  // ─ 위젯 상태 (서버 동기화: 초기값은 서버에서 주입) ─
  const [widgetState, setWidgetState] = useState<WidgetState>(
    initialWidgetState,
  );
  // 보관함은 widget_state(단일 행 JSON)가 아니라 자체 테이블에 산다 —
  // 본문 사본이 들어가므로 순서 한 칸 바꿀 때마다 수 MB 를 왕복할 수 없다.
  const [archived, setArchived] = useState<ArchivedSummary[]>([]);
  const [openArchiveId, setOpenArchiveId] = useState<number | null>(null);

  const loadArchived = useCallback(async () => {
    try {
      const res = await apiFetch("/api/archive", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setArchived(json.archived ?? []);
    } catch {
      /* 다음 시도에서 복구 */
    }
  }, []);

  useEffect(() => {
    void loadArchived();
  }, [loadArchived]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 서버 저장 (디바운스) — 폴더/핀/메모 변경 시 호출
  const persist = useCallback((next: WidgetState) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void apiFetch("/api/widget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch(() => {
        /* 네트워크 오류 무시 — 다음 변경 시 재시도 */
      });
    }, 500);
  }, []);

  useEffect(() => {
    try {
      const savedCols = localStorage.getItem(STORAGE_KEYS.columns) as
        | ColumnsPref
        | null;
      if (savedCols) setColumns(savedCols);
    } catch {
      /* */
    }

    // 1회 마이그레이션: 서버가 비어있고 localStorage 에 실데이터가 있으면 서버로 이관
    const serverEmpty =
      initialWidgetState.pins.length === 0 &&
      initialWidgetState.memos.length === 0 &&
      initialWidgetState.folders.every((f) => f.links.length === 0);
    if (serverEmpty) {
      const local = loadWidgetState();
      const localHasData =
        local.pins.length > 0 ||
        local.memos.length > 0 ||
        local.folders.some((f) => f.links.length > 0);
      if (localHasData) {
        setWidgetState(local);
        persist(local);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFolders = (folders: WidgetFolder[]) => {
    setWidgetState((prev) => {
      const next = { ...prev, folders };
      persist(next);
      return next;
    });
  };
  const updatePins = (pins: Pin[]) => {
    setWidgetState((prev) => {
      const next = { ...prev, pins };
      persist(next);
      return next;
    });
  };
  const updateMemos = (memos: Memo[]) => {
    setWidgetState((prev) => {
      const next = { ...prev, memos };
      persist(next);
      return next;
    });
  };

  // ─ 메일 fetch ─
  const fetchInboxes = useCallback(
    async (showSpinner: boolean, force = showSpinner, silent = false) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    if (showSpinner) setRefreshing(true);
    // silent = 표식만 다시 읽는 경우. 스켈레톤이 번쩍이지 않게 loading 을 건드리지 않는다.
    if (!silent) {
      setBoxes((prev) => prev.map((b) => ({ ...b, loading: true, error: null })));
    }

    try {
      // force = IMAP 재조회. 손으로 누른 새로고침만 쓴다 —
      // 주기적인 수집은 서버가 스스로 한다(lib/mail-poller).
      const res = await apiFetch(force ? "/api/mail?force=1" : "/api/mail", {
        cache: "no-store",
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MailResponse;

      setBoxes((prev) =>
        prev.map((b) => {
          const incoming = json.inboxes.find(
            (i) => i.account.id === b.account.id,
          );
          if (!incoming) return { ...b, loading: false };
          return {
            account: b.account,
            loading: false,
            messages: incoming.messages,
            unreadCount: incoming.unreadCount,
            error: incoming.error,
          };
        }),
      );
      setFetchedAt(json.fetchedAt);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const message = err instanceof Error ? err.message : "알 수 없는 오류";
      setBoxes((prev) =>
        prev.map((b) => ({ ...b, loading: false, error: message })),
      );
    } finally {
      setRefreshing(false);
    }
    },
    [],
  );

  useEffect(() => {
    if (initialAccounts.length === 0) return;
    /*
     * 첫 로드만 가져오고, 뒤로는 화면에서 주기적으로 두드리지 않는다.
     *
     * 수집은 서버가 10분마다 스스로 한다. 화면마다 타이머를 돌리면 탭을 여러 개
     * 열어 둔 만큼 IMAP 을 두드리게 되고, 정작 브라우저를 닫아 두면 아무 일도
     * 일어나지 않는다 — 그래서 "새 메일이 왔다" 를 알아챌 곳이 없었다.
     *
     * 서버가 새로 가져온 것을 보려면 새로고침을 누르거나 페이지를 다시 열면 된다
     * (캐시는 만료되지 않으므로 IMAP 을 다시 타지 않는다).
     */
    fetchInboxes(false, false);
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchInboxes, initialAccounts.length]);

  // ─ DnD ─
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setBoxes((prev) => {
      const oldIdx = prev.findIndex((b) => b.account.id === active.id);
      const newIdx = prev.findIndex((b) => b.account.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      const next = arrayMove(prev, oldIdx, newIdx);
      void apiFetch("/api/accounts/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderedIds: next.map((b) => b.account.id),
        }),
      }).catch(() => {
        /* */
      });
      return next;
    });
  };

  /**
   * 읽음/표식/보관 변경 후 목록만 다시 읽는다 (캐시 사용 → IMAP 재조회 없음).
   * 보관함도 함께 읽는다 — 목록의 보관 버튼이 두 곳을 동시에 바꾼다.
   */
  const onFlagsChanged = useCallback(() => {
    void fetchInboxes(false, false, true);
    void loadArchived();
  }, [fetchInboxes, loadArchived]);

  const totalUnread = boxes.reduce((s, b) => s + (b.unreadCount ?? 0), 0);

  const inboxGrid =
    initialAccounts.length === 0 ? (
      <EmptyState />
    ) : (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={boxes.map((b) => b.account.id)}
          strategy={rectSortingStrategy}
        >
          <section className={cn("grid gap-4", COLUMN_CLASS[columns])}>
            {boxes.map((b) => (
              <SortableInboxCard
                key={b.account.id}
                data={b}
                onFlagsChanged={onFlagsChanged}
              />
            ))}
          </section>
        </SortableContext>
      </DndContext>
    );

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-[1920px] flex-col gap-6 px-6 py-10 lg:px-10">

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-(--color-surface) ring-1 ring-(--color-border-soft)">
            <Mail className="h-5 w-5 text-(--color-accent)" />
          </div>
          <div>
            <h1
              className="text-2xl leading-tight"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              MailBento
            </h1>
            <p className="text-xs text-(--color-fg-4)">
              {initialAccounts.length === 0
                ? "연결된 계정 없음"
                : fetchedAt
                  ? `${boxes.length}개 박스 · 안 읽음 ${totalUnread} · ${formatRelativeTime(fetchedAt)} 업데이트`
                  : "메일 가져오는 중…"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <AgentChat />
          <MemoBentoLink href={memobentoUrl} />
          <button
            type="button"
            onClick={() => fetchInboxes(true)}
            disabled={refreshing || initialAccounts.length === 0}
            className={cn(
              "flex items-center gap-2 rounded-full bg-(--color-surface) px-4 py-2 text-sm text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)",
              (refreshing || initialAccounts.length === 0) && "opacity-60",
            )}
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
            />
            새로고침
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={widgetEnabled}
            onClick={() => onWidgetToggle(!widgetEnabled)}
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition",
              widgetEnabled
                ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-(--color-accent)/40 hover:bg-(--color-accent)/25"
                : "bg-(--color-surface) text-(--color-fg-3) ring-(--color-border-soft) hover:bg-(--color-surface-2) hover:text-(--color-fg-2)",
            )}
            aria-label="위젯 대시보드 토글"
            title="위젯 대시보드 켜기/끄기"
          >
            <LayoutDashboard className="h-4 w-4" />
            <span className="hidden sm:inline">위젯</span>
            <span
              aria-hidden
              className={cn(
                "relative h-4 w-7 shrink-0 rounded-full transition-colors",
                widgetEnabled ? "bg-(--color-accent)" : "bg-(--color-border)",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all",
                  widgetEnabled ? "left-[14px]" : "left-0.5",
                )}
              />
            </span>
          </button>
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-full bg-(--color-accent-soft) px-4 py-2 text-sm text-(--color-accent-strong) ring-1 ring-(--color-accent)/40 transition hover:bg-(--color-accent)/25"
          >
            <SettingsIcon className="h-4 w-4" />
            설정
          </Link>
        </div>
      </header>

      {/* 본문 — 위젯 ON 시 2×2 그리드
          (r1c1)헤더 (r1c2)폴더  ·  (r2c1)메일박스 (r2c2)코크보드+메모
          → 폴더 한 변 = 헤더 높이, 코크보드/메모 = 폴더 폭 × 메일박스 높이 */}
      {widgetEnabled ? (
        isWide ? (
          <div
            className="grid gap-5"
            style={{
              gridTemplateColumns: `minmax(0,1fr) ${headerH * 3 + 32}px`,
              gridTemplateRows: "auto auto",
            }}
          >
            <div ref={headerRef} className="min-w-0">
              <WidgetHeader regions={regions} />
            </div>
            <div style={{ height: headerH }}>
              <WidgetFoldersWing
                folders={widgetState.folders}
                onChange={updateFolders}
                size={headerH}
              />
            </div>
            <div className="min-w-0">{inboxGrid}</div>
            <div className="relative min-h-0">
              <div className="absolute inset-0">
                <WidgetSideWing
                  pins={widgetState.pins}
                  memos={widgetState.memos}
                  archived={archived}
                  onPinsChange={updatePins}
                  onMemosChange={updateMemos}
                  onArchivedChange={setArchived}
                  onOpenArchived={(item) => setOpenArchiveId(item.id)}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div ref={headerRef}>
              <WidgetHeader regions={regions} />
            </div>
            <WidgetFoldersWing
              folders={widgetState.folders}
              onChange={updateFolders}
            />
            {inboxGrid}
            <div className="h-[520px]">
              <WidgetSideWing
                pins={widgetState.pins}
                memos={widgetState.memos}
                archived={archived}
                onPinsChange={updatePins}
                onMemosChange={updateMemos}
                onArchivedChange={setArchived}
                onOpenArchived={(item) => setOpenArchiveId(item.id)}
              />
            </div>
          </div>
        )
      ) : (
        <div className="mx-auto w-full max-w-[1440px]">{inboxGrid}</div>
      )}

      {/* 보관본 열람 — 사본을 그대로 읽으므로 IMAP 을 타지 않는다 */}
      <MessageModal
        accountId={0}
        accountDisplayName="보관함"
        messageId={openArchiveId ? String(openArchiveId) : null}
        archiveId={openArchiveId}
        onClose={() => setOpenArchiveId(null)}
      />

      <footer className="mt-2 text-center text-xs text-(--color-fg-4)">
        MailBento · 박스 드래그로 순서변경
      </footer>
    </main>
  );
}

function EmptyState() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-(--color-surface) ring-1 ring-(--color-border-soft)">
        <Mail className="h-7 w-7 text-(--color-accent)" />
      </div>
      <div>
        <h2
          className="mb-1 text-xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          연결된 계정이 없습니다
        </h2>
        <p className="text-sm text-(--color-fg-3)">
          오른쪽 위 “계정” 에서 Gmail / Outlook / IMAP 메일을 추가하세요.
        </p>
      </div>
      <Link
        href="/settings"
        className="rounded-full bg-(--color-accent) px-5 py-2 text-sm font-medium text-(--color-bg) hover:bg-(--color-accent-strong)"
      >
        계정 추가하러 가기
      </Link>
    </section>
  );
}
