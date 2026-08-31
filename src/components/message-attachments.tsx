"use client";

import {
  AlertCircle,
  Download,
  EyeOff,
  File as FileIcon,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api-path";
import type { MailAttachment } from "@/lib/providers/types";
import { cn } from "@/lib/utils";

export interface MailBodyExtras {
  attachments: MailAttachment[];
  /**
   * **주소를 안 부른** 그림 수. 0 이면 아무 말도 하지 않는다.
   *
   * 이름이 tracker 지만 "추적하려던 것" 이라는 뜻은 아니다. "안 보이는 것"
   * 이라는 뜻도 아니다 — 문턱에 걸리는 것 중에는 가로 구분선(600×1)이나 표
   * 간격용 조각(20×1)처럼 **브라우저에서 그대로 보이는** 그림이 섞여 있다.
   * 우리가 아는 것은 스타일로 가려져 있거나 몇 픽셀밖에 안 됐다는 것뿐이다
   * (BlockedTrackerNote 의 글이 딱 그만큼만 말한다).
   */
  blockedTrackers: number;
  /** 서버가 대신 받아 온 원격 그림 수. 모르면 null. */
  proxiedImages: number | null;
}

/**
 * 서버가 준 것을 믿되, 없는 것과 망가진 것을 걸러 낸다.
 *
 * 타입은 이 칸들을 필수로 적지만 **런타임에는 없을 수 있다.** 이 창은 라이브
 * 메일과 보관 사본을 함께 그리는데, 사본은 이 칸이 생기기 전에 떠 둔 것일 수
 * 있고 본문 캐시에도 옛 모양이 남는다. 없으면 없는 대로 그려야지, 터지면
 * 첨부는커녕 본문도 못 본다.
 */
export function readMailExtras(detail: unknown): MailBodyExtras {
  const raw = (detail ?? {}) as {
    attachments?: unknown;
    blockedTrackers?: unknown;
    proxiedImages?: unknown;
  };

  const attachments: MailAttachment[] = Array.isArray(raw.attachments)
    ? raw.attachments.flatMap((item: unknown) => {
        const a = item as Partial<MailAttachment> | null;
        // id 가 없으면 내려받을 주소를 못 만든다 — 눌리지 않는 줄은 그리지 않는다
        if (!a || typeof a.id !== "string" || !a.id) return [];
        const name =
          typeof a.filename === "string" && a.filename.trim()
            ? a.filename.trim()
            : null;
        return [
          {
            id: a.id,
            filename: name,
            contentType:
              typeof a.contentType === "string" && a.contentType
                ? a.contentType
                : "application/octet-stream",
            size:
              typeof a.size === "number" && Number.isFinite(a.size) && a.size >= 0
                ? a.size
                : null,
          },
        ];
      })
    : [];

  const count = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;

  return {
    attachments,
    blockedTrackers: count(raw.blockedTrackers) ?? 0,
    proxiedImages: count(raw.proxiedImages),
  };
}

/* ============================================================
   글자 다듬기
   ============================================================ */

/** 사람이 읽을 크기. 설정 화면(body-cache-panel)의 눈금과 같은 결로 맞춘다. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 이름을 몸통과 확장자로 가른다.
 *
 * 긴 이름을 통째로 자르면 하필 뒤가 잘려 무슨 파일인지가 사라진다
 * ("2026년_1분기_결산보고서_최종_최종…"). 몸통만 줄이고 확장자는 남긴다.
 */
function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  // 앞이 비었거나(숨김 파일) 뒤가 비었거나 너무 길면 확장자로 치지 않는다
  if (dot <= 0 || dot === name.length - 1 || name.length - dot > 8) {
    return { stem: name, ext: "" };
  }
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

const KNOWN_KINDS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/zip": "ZIP",
  "application/x-zip-compressed": "ZIP",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "Word",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PPT",
  "text/plain": "텍스트",
  "text/html": "HTML",
  "text/csv": "CSV",
  "message/rfc822": "메일",
  "application/octet-stream": "파일",
};

/**
 * 종류를 한 낱말로.
 *
 * MIME 타입을 그대로 보여 주면 칸을 다 먹는다
 * (`…presentationml.presentation` 이 이름보다 길다).
 */
function kindLabel(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (KNOWN_KINDS[base]) return KNOWN_KINDS[base];
  const slash = base.indexOf("/");
  const type = slash < 0 ? base : base.slice(0, slash);
  const sub = slash < 0 ? "" : base.slice(slash + 1).replace(/^x-/, "");
  if (type === "image") return sub ? `${sub.toUpperCase()} 이미지` : "이미지";
  if (type === "audio") return "오디오";
  if (type === "video") return "동영상";
  // 모르는 것을 억지로 옮기지 않는다. 다만 길면 뜻보다 소음이라 접는다.
  if (sub && sub.length <= 8) return sub.toUpperCase();
  return "파일";
}

function iconFor(contentType: string): LucideIcon {
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (base.startsWith("image/")) return ImageIcon;
  if (base === "application/pdf" || base.startsWith("text/")) return FileText;
  if (/zip|compressed|tar|gzip|x-7z|rar/.test(base)) return FileArchive;
  return FileIcon;
}

/* ============================================================
   내려받기
   ============================================================ */

/**
 * 응답 헤더에서 저장할 이름을 되읽는다.
 *
 * `<a href="/api/…" download>` 로 링크를 걸지 않는 이유가 여기 있다. 값 없는
 * `download` 속성은 서버의 `Content-Disposition` 을 무시하고 주소 마지막
 * 토막을 파일 이름으로 삼는다 — "보고서.pdf" 가 아니라 파트 번호 "2" 로
 * 저장된다. 그래서 이름을 우리가 지어내지 않고 서버가 보낸 헤더에서 읽는다.
 */
function nameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  // RFC 5987 — 한글 이름은 filename*=UTF-8''%… 쪽에만 온전히 담긴다. 먼저 본다.
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (star) {
    const m = /^[^']*'[^']*'(.*)$/.exec(star[1].trim());
    if (m) {
      try {
        const decoded = decodeURIComponent(m[1]).trim();
        if (decoded) return decoded;
      } catch {
        /* 잘못된 % 이스케이프 — 아래 filename 으로 내려간다 */
      }
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
  if (plain) {
    const value = (plain[1] ?? plain[2] ?? "").trim();
    if (value) return value;
  }
  return null;
}

/** 받은 바이트를 파일로 떨군다. 이름은 위 주석대로 서버가 정한 것을 쓴다. */
function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 곧바로 거두면 브라우저가 저장을 시작하기 전에 주소가 사라지는 일이 있다.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** 실패를 사람 말로. 상태 코드만 보면 무엇을 해야 할지 알 수 없다. */
async function reasonFor(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  if (body && typeof body.error === "string" && body.error.trim()) {
    return body.error.trim();
  }
  if (res.status === 401) return "로그인이 풀렸습니다 — 새로고침해 주세요";
  if (res.status === 404) return "원본 메일에서 찾지 못했습니다";
  if (res.status === 410) return "원본이 사라져 더는 받을 수 없습니다";
  if (res.status === 502 || res.status === 504)
    return "메일 서버가 응답하지 않습니다";
  return `HTTP ${res.status}`;
}

/* ============================================================
   화면
   ============================================================ */

/**
 * 칩 한 개의 겉모양. 내려받을 수 있는 것(단추)과 없는 것(글자)이 함께 쓴다.
 *
 * 22rem 에서 자른다 — 이름 하나가 줄을 통째로 먹으면 나머지 첨부가 안 보인다.
 * 잘린 이름은 title 과 aria-label 에 온전히 남는다.
 */
const CHIP =
  "flex max-w-[22rem] items-center gap-1.5 rounded-full bg-(--color-bg-2) py-1 pr-2 pl-2.5 text-[11px] ring-1 ring-(--color-border-soft)";

/** 이보다 많으면 접는다. 첨부 열두 개가 본문을 아래로 밀어내지 않게. */
const COLLAPSE_AFTER = 5;
/** 접었을 때 남겨 두는 개수. */
const KEEP_WHEN_COLLAPSED = 4;

export function AttachmentBar({
  attachments,
  urlFor,
  unavailableNote,
}: {
  attachments: MailAttachment[];
  /**
   * id 로 내려받기 주소를 만든다.
   *
   * 라이브 메일과 보관 사본이 서로 다른 곳에서 오므로 부르는 쪽이 정한다.
   * 만들 수 없으면 null — 그러면 단추가 아니라 가만한 조각으로 그린다.
   */
  urlFor: (id: string) => string | null;
  /**
   * 하나도 받을 수 없을 때 덧붙일 한 줄.
   *
   * 왜 못 받는지는 부르는 쪽이 안다(이 창은 보관 사본도 그린다). 여기서
   * 넘겨받지 않으면 아무 말도 하지 않는다.
   */
  unavailableNote?: string;
}) {
  /** 지금 받고 있는 첨부의 id. 한 번에 하나만 받는다. */
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ name: string; reason: string } | null>(
    null,
  );
  const [showAll, setShowAll] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // 창을 닫거나 다른 메일로 넘어가면 받던 것을 놓는다 (부르는 쪽이 key 로 갈아끼운다).
  useEffect(() => () => abort.current?.abort(), []);

  const download = async (att: MailAttachment) => {
    // 받는 중인 단추는 켜 둔 채라 다시 눌릴 수 있다. 두 번째 누름은 흘린다.
    if (busy !== null) return;
    const shown = att.filename ?? "이름 없는 첨부";
    const url = urlFor(att.id);
    if (!url) {
      setFailed({ name: shown, reason: "받아 올 곳을 알 수 없습니다" });
      return;
    }
    const ac = new AbortController();
    abort.current = ac;
    setBusy(att.id);
    setFailed(null);
    try {
      const res = await apiFetch(url, { cache: "no-store", signal: ac.signal });
      if (!res.ok) throw new Error(await reasonFor(res));
      const blob = await res.blob();
      saveBlob(
        blob,
        nameFromDisposition(res.headers.get("Content-Disposition")) ??
          att.filename ??
          "첨부파일",
      );
    } catch (e) {
      // 창을 닫아서 끊은 것은 실패가 아니다
      if ((e as Error | null)?.name === "AbortError") return;
      setFailed({
        name: shown,
        reason: e instanceof Error ? e.message : "알 수 없는 오류",
      });
    } finally {
      if (abort.current === ac) abort.current = null;
      setBusy((cur) => (cur === att.id ? null : cur));
    }
  };

  const collapsed = !showAll && attachments.length > COLLAPSE_AFTER;
  const visible = collapsed
    ? attachments.slice(0, KEEP_WHEN_COLLAPSED)
    : attachments;
  const hidden = attachments.length - visible.length;
  const total = attachments.every((a) => a.size !== null)
    ? attachments.reduce((sum, a) => sum + (a.size ?? 0), 0)
    : null;

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-(--color-fg-4)">
        <Paperclip className="h-3 w-3 shrink-0" />
        <span>
          첨부 {attachments.length}개
          {total !== null ? ` · ${formatBytes(total)}` : ""}
        </span>
      </div>

      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {visible.map((att) => {
          const shown = att.filename ?? "이름 없는 첨부";
          const { stem, ext } = splitName(shown);
          const kind = kindLabel(att.contentType);
          const size = att.size !== null ? formatBytes(att.size) : null;
          const Icon = iconFor(att.contentType);
          const running = busy === att.id;
          const url = urlFor(att.id);

          const face = (
            <>
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="flex min-w-0 items-baseline">
                <span className="truncate">{stem}</span>
                {ext && <span className="shrink-0">{ext}</span>}
              </span>
              <span className="shrink-0 text-(--color-fg-4)">
                {kind}
                {size ? ` · ${size}` : ""}
              </span>
            </>
          );

          return (
            <li key={att.id} className="min-w-0 max-w-full">
              {url ? (
                <button
                  type="button"
                  onClick={() => void download(att)}
                  // 누른 그 단추는 끄지 않는다 — disabled 가 되면 브라우저가
                  // 포커스를 몸통으로 되돌려, 키보드로 받은 사람은 받고 나서 자기가
                  // 어디 있었는지를 잃는다. 나머지만 잠근다.
                  disabled={busy !== null && !running}
                  aria-busy={running}
                  // 눈에 보이는 글자가 이름으로 시작하도록 이어 붙인다 —
                  // 스크린리더가 "무엇을" 받는지 먼저 읽는다.
                  aria-label={`${shown} 내려받기 — ${kind}${size ? `, ${size}` : ""}`}
                  title={shown}
                  className={cn(
                    CHIP,
                    "text-(--color-fg-2) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg)",
                    "focus-visible:ring-2 focus-visible:ring-(--color-accent) focus-visible:outline-none",
                    // 받는 동안 다른 것도 눌리면 어느 것을 받는지 알 수 없다
                    busy !== null && !running && "opacity-40",
                  )}
                >
                  {face}
                  {running ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  )}
                </button>
              ) : (
                /* 받을 곳이 없다(보관 사본). 눌리지 않는 단추를 두느니 단추가
                   아닌 것으로 그린다 — 눌러 보고 실패하는 것보다 낫다. */
                <span
                  className={cn(CHIP, "text-(--color-fg-3)")}
                  title={`${shown} — 이 사본에서는 받을 수 없습니다`}
                >
                  {face}
                </span>
              )}
            </li>
          );
        })}

        {hidden > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="rounded-full px-2.5 py-1 text-[11px] text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg) focus-visible:ring-2 focus-visible:ring-(--color-accent) focus-visible:outline-none"
            >
              {hidden}개 더 보기
            </button>
          </li>
        )}
        {showAll && attachments.length > COLLAPSE_AFTER && (
          <li>
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="rounded-full px-2.5 py-1 text-[11px] text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg) focus-visible:ring-2 focus-visible:ring-(--color-accent) focus-visible:outline-none"
            >
              접기
            </button>
          </li>
        )}
      </ul>

      {/* 목록은 보이는데 하나도 못 받는 경우 — 왜인지 말해 준다.
          말이 없으면 사람은 "왜 단추가 없지" 에서 멈춘다. */}
      {unavailableNote && !attachments.some((a) => urlFor(a.id) !== null) && (
        <p className="mt-2 text-[11px] text-(--color-fg-4)">{unavailableNote}</p>
      )}

      {/* 실패는 지운 자리가 아니라 목록 아래에 남긴다 — 다시 눌러 볼 수 있게. */}
      {failed && (
        <p
          role="status"
          className="mt-2 flex items-start gap-1.5 text-[11px] text-(--color-fg-3)"
        >
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-(--color-danger)" />
          <span className="min-w-0 break-words">
            <b className="font-medium text-(--color-fg-2)">{failed.name}</b> 을
            받지 못했습니다 — {failed.reason}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * 부르지 않은 그림을 알린다.
 *
 * 조용히 지우면 사람은 "그림이 깨졌네" 로 읽는다. 무엇을 왜 안 불렀는지
 * 한 줄로 말해 준다. 색이 아니라 아이콘과 글로 뜻을 나눈다.
 *
 * ── **아는 만큼만 말한다** ──
 * 앞에서는 이 수를 "추적 이미지 N개" 라고 적었다. N 은 `isTrackingPixel` 이
 * 떨군 img 를 **전부** 센 값인데, 거기에는 추적과 무관한 것이 섞인다:
 * 다크모드용 로고 사본(`display:none`) · 모바일 전용 히어로 · 표 간격용 1×1
 * spacer. 실측: 진짜 추적 픽셀이 하나뿐인 메일에 **"추적 이미지 4개"** 가 떴다
 * (rig/fp2.ts — 다크모드 1 · 모바일 1 · spacer 1 이 함께 세어졌다).
 *
 * 우리는 발신자의 **의도를 알 수 없다.** 아는 것은 딱 하나 — "보이지 않게
 * 되어 있어서 부르지 않았다" 는 것뿐이다. 사람이 이 숫자를 읽고 프라이버시를
 * 판단하므로, 넘겨짚어 "추적" 이라 부르지 않고 우리가 실제로 한 일을 적는다.
 * 반대로 줄여 말해서도 안 된다 — 그중에 추적 픽셀이 있었다면 그것도 안 나갔다는
 * 사실은 이 줄이 말해 주어야 하는 값이다.
 *
 * ── 남은 그림이 있느냐에 따라 말이 달라져야 한다 ──
 * 앞에서는 막은 픽셀이 하나라도 있으면 무조건 "보낸 사람은 이 메일을 언제
 * 열었는지 알 수 없습니다" 라고 단언했다. **그런데 바로 다음 문장이 "나머지
 * 이미지 N개는 서버가 대신 받아 왔습니다" 였다.** 그 대신 받아 오는 요청은
 * 사람이 메일을 여는 바로 그 순간 발신자에게 나간다. 수신자마다 다른 주소
 * (`hero-<수신자ID>.jpg`)를 박아 두면 "누가 언제 열었는지" 는 그대로 샌다 —
 * 프록시가 가리는 것은 읽는 사람의 IP 와 브라우저뿐이다. 두 문장이 서로를
 * 부정하고 있었다.
 *
 * 사람이 이 글을 읽고 프라이버시를 판단한다. 나간 요청이 하나도 없을 때만
 * "알 수 없다" 고 말하고, 있을 때는 무엇이 가려지고 무엇이 안 가려지는지
 * 그대로 적는다.
 *
 * ── 막은 것이 없어도 말해야 한다 ──
 * 갈래를 나눈 뒤에도 이 줄은 `blocked > 0` 일 때만 떴다. 그래서 **추적 픽셀은
 * 없고 프록시로 나간 그림만 있는 메일**에서는 화면에 아무 말도 안 나왔다.
 * 실측(리그에서 blockedTrackers=0 · proxiedImages=1 인 메일을 열어 DOM 확인):
 * 안내 줄이 하나도 그려지지 않는다. 그런데 그 메일도 여는 순간 발신자에게
 * 요청이 나가고 열람 시각이 샌다 — 가장 조용한 경우가 가장 말이 없었다.
 * 침묵은 "아무 일도 없었다" 로 읽힌다. 나간 요청이 있으면 무엇이 있었는지
 * 반드시 적는다.
 */
export function BlockedTrackerNote({
  blocked,
  proxiedImages,
  archived = false,
  className,
}: {
  blocked: number;
  proxiedImages: number | null;
  /** 보관 사본을 보고 있나. 그러면 요청은 **열 때마다** 나간다. */
  archived?: boolean;
  className?: string;
}) {
  const proxied =
    proxiedImages !== null && proxiedImages > 0 ? proxiedImages : 0;
  // 막은 것도 없고 나간 것도 없으면 할 말이 없다
  if (blocked <= 0 && proxied <= 0) return null;

  /**
   * 프록시가 가리는 것과 못 가리는 것 — 세 갈래가 같은 문장을 쓴다.
   *
   * 보관 사본은 시제가 다르다. 사본 HTML 에 프록시 주소가 그대로 남아 있어
   * **열 때마다** 요청이 새로 나간다 — 한 번 있었던 일이 아니다.
   */
  const proxyNote = archived ? (
    <>
      이 사본을 열 때마다 서버가 대신 받아 옵니다 — 읽는 사람의 IP 주소와
      브라우저 정보는 가려지지만,{" "}
      <b className="font-medium text-(--color-fg-3)">
        사본을 연 시각은 그때마다 보낸 사람에게 전해집니다.
      </b>
    </>
  ) : (
    <>
      서버가 대신 받아 왔습니다 — 읽는 사람의 IP 주소와 브라우저 정보는
      가려지지만,{" "}
      <b className="font-medium text-(--color-fg-3)">
        이 메일을 연 시각은 보낸 사람에게 전해집니다.
      </b>
    </>
  );

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[11px] text-(--color-fg-4)",
        className,
      )}
    >
      <EyeOff className="mt-0.5 h-3 w-3 shrink-0 text-(--color-warn)" />
      <span className="min-w-0">
        {blocked > 0 ? (
          <>
            스타일로 가려져 있거나 몇 픽셀 크기밖에 안 되는 이미지{" "}
            <b className="font-medium text-(--color-fg-3)">{blocked}개</b>는
            주소를 부르지 않았습니다 — 열람을 알리는 추적 픽셀이 흔히 이런
            모습입니다. 다만 가로 구분선이나 표 간격용 조각처럼{" "}
            <b className="font-medium text-(--color-fg-3)">
              화면에 그대로 보이는
            </b>{" "}
            그림도 크기가 같아, 어느 쪽인지는 가려낼 수 없습니다.{" "}
            {proxied > 0 ? (
              <>나머지 이미지 {proxied}개는 {proxyNote}</>
            ) : archived ? (
              <>
                바깥으로 나가는 요청이 하나도 없어, 이 사본을 열어도 보낸
                사람은 알지 못합니다.
              </>
            ) : (
              <>
                바깥으로 나간 요청이 하나도 없어, 보낸 사람은 이 메일을
                열었는지 알 수 없습니다.
              </>
            )}
          </>
        ) : (
          // 막은 픽셀은 없고 프록시로 나간 그림만 있는 메일
          <>
            이미지 <b className="font-medium text-(--color-fg-3)">{proxied}개</b>
            는 {proxyNote}
          </>
        )}
      </span>
    </p>
  );
}
