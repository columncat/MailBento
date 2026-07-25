"use client";

import { useEffect, useState } from "react";

import {
  loadWidgetEnabled,
  saveWidgetEnabled,
  type WidgetState,
} from "@/lib/widget-storage";

import { Dashboard, type AccountSummary } from "./dashboard";

interface Props {
  initialAccounts: AccountSummary[];
  initialWidgetState: WidgetState;
  refreshIntervalSeconds: number;
  forceOnInterval: boolean;
  authEnabled: boolean;
  /** MEMOBENTO_URL override. null 이면 현재 호스트의 3001 포트로 유추. */
  memobentoUrl: string | null;
}

export function AppLayout(props: Props) {
  const [widgetEnabled, setWidgetEnabled] = useState(false);

  useEffect(() => {
    setWidgetEnabled(loadWidgetEnabled());
  }, []);

  const onWidgetToggle = (v: boolean) => {
    setWidgetEnabled(v);
    saveWidgetEnabled(v);
  };

  return (
    <Dashboard
      {...props}
      widgetEnabled={widgetEnabled}
      onWidgetToggle={onWidgetToggle}
    />
  );
}
