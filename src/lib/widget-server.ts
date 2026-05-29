import { eq } from "drizzle-orm";

import { db, schema } from "./db";
import { ensureFolders, type WidgetState } from "./widget-storage";

const ROW_ID = 1;

/** DB 에 저장된 위젯 상태를 읽는다(없으면 폴더 3개의 빈 상태). */
export function getWidgetState(): WidgetState {
  const row = db
    .select()
    .from(schema.widgetState)
    .where(eq(schema.widgetState.id, ROW_ID))
    .get();

  let parsed: Partial<WidgetState> = {};
  if (row?.data) {
    try {
      parsed = JSON.parse(row.data) as Partial<WidgetState>;
    } catch {
      /* 손상된 JSON → 빈 상태로 폴백 */
    }
  }

  return normalize(parsed);
}

/** 위젯 상태를 DB 에 저장(단일 행 upsert). */
export function setWidgetState(input: Partial<WidgetState>): WidgetState {
  const state = normalize(input);
  const data = JSON.stringify(state);
  db.insert(schema.widgetState)
    .values({ id: ROW_ID, data })
    .onConflictDoUpdate({
      target: schema.widgetState.id,
      set: { data, updatedAt: new Date() },
    })
    .run();
  return state;
}

function normalize(parsed: Partial<WidgetState>): WidgetState {
  return {
    folders: ensureFolders(Array.isArray(parsed.folders) ? parsed.folders : []),
    pins: Array.isArray(parsed.pins) ? parsed.pins : [],
    memos: Array.isArray(parsed.memos) ? parsed.memos : [],
  };
}
