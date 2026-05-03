"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { initTelemetry, trackPageView } from "@/lib/telemetry";

/**
 * Boots the telemetry library once at app start, and emits a page_view
 * event whenever the route changes (Next.js App Router doesn't fire a
 * native navigation event for client-side transitions).
 *
 * useSearchParams must live under Suspense in App Router, otherwise
 * `next build` aborts with `useSearchParams should be wrapped`.
 */
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    initTelemetry();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    trackPageView(pathname, "router", {
      qs: searchParams ? searchParams.toString() : "",
    });
  }, [pathname, searchParams]);

  return null;
}

export default function TelemetryProvider() {
  return (
    <Suspense fallback={null}>
      <PageViewTracker />
    </Suspense>
  );
}
