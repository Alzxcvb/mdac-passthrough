"use client";

import { track } from "@vercel/analytics/react";
import { ANALYTICS_EVENTS } from "./analytics-events";

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue>;

export function trackEvent(name: string, properties?: AnalyticsProperties): void {
  if (typeof window === "undefined") return;

  try {
    track(name, properties);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Analytics track failed", name, error);
    }
  }
}

export { ANALYTICS_EVENTS };
