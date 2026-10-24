"use client";

import { useEffect, useState } from "react";
import type { RegionInput } from "@/lib/regions";

import {
  loadWidgetEnabled,
  saveWidgetEnabled,
  type WidgetState,
} from "@/lib/widget-storage";

import type { AppUrls } from "./cross-app-link";
import { Dashboard, type AccountSummary } from "./dashboard";

interface Props {
  initialAccounts: AccountSummary[];
  initialWidgetState: WidgetState;
  regions: RegionInput[];
  authEnabled: boolean;
  /** 형제 앱 주소 (`lib/app-urls.ts`). 빈 칸은 화면이 유추한다. */
  appUrls: AppUrls;
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
