"use client";

import { useState, useEffect, useRef } from "react";
import { type FormData } from "@/lib/types";
import { mapFormToMdac, STATE_TO_CODE } from "@/lib/mdac-codes";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";

const PASSTHROUGH_URL = process.env.NEXT_PUBLIC_PASSTHROUGH_URL || "";

interface Props {
  data: FormData;
  onSuccess: (payload: { qrImageBase64?: string; pdfBase64?: string; jobId?: string }) => void;
  onBack: () => void;
}

type Phase = "intro" | "submitting" | "submitted" | "retrieving" | "done" | "failed";

interface JobStatus {
  status:
    | "queued"
    | "filling"
    | "solving"
    | "submitting"
    | "submitted"
    | "retrieving"
    | "done"
    | "failed";
  message: string;
  error?: string;
  attempts?: number;
  qrImageBase64?: string;
  pdfBase64?: string;
}

export default function SubmitStep({ data, onSuccess, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [jobId, setJobId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [pin, setPin] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [agreedNotAffiliated, setAgreedNotAffiliated] = useState(false);
  const [cityCode, setCityCode] = useState<string>("");
  const [resolvingCity, setResolvingCity] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFailRef = useRef(0);

  // Resolve the AJAX city code on mount (the official site populates city via state.)
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      const stateCode = STATE_TO_CODE[data.stateInMalaysia];
      if (!stateCode) return;
      setResolvingCity(true);
      try {
        const r = await fetch(`/api/mdac/cities?state=${encodeURIComponent(stateCode)}`);
        const json = (await r.json()) as { cities?: { value: string; label: string }[] };
        if (cancelled) return;
        const target = (data.cityInMalaysia || "").toLowerCase();
        const match = json.cities?.find((c) => c.label.toLowerCase().includes(target));
        if (match) setCityCode(match.value);
      } catch {
        // non-fatal — backend will try to resolve on its own
      } finally {
        if (!cancelled) setResolvingCity(false);
      }
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [data.stateInMalaysia, data.cityInMalaysia]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollFailRef.current = 0;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${PASSTHROUGH_URL}/api/jobs/${id}`);
        const json = (await r.json()) as JobStatus & { success?: boolean };
        pollFailRef.current = 0;
        if (!r.ok) {
          setError(json.error || "Lost contact with the server.");
          setPhase("failed");
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }
        setStatusMessage(json.message || "");
        if (json.status === "submitted") {
          setPhase("submitted");
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (json.status === "done") {
          setPhase("done");
          if (pollRef.current) clearInterval(pollRef.current);
          trackEvent(ANALYTICS_EVENTS.qrGenerated, { transport: data.modeOfTransport || "unknown" });
          onSuccess({ qrImageBase64: json.qrImageBase64, pdfBase64: json.pdfBase64, jobId: id });
        } else if (json.status === "failed") {
          setError(json.error || "Submission failed.");
          setPhase("failed");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch (err) {
        pollFailRef.current += 1;
        console.warn("[poll] error", err);
        if (pollFailRef.current >= 8) {
          setError("Lost connection to the server. Check your internet connection and try again.");
          setPhase("failed");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }
    }, 1500);
  }

  async function handleSubmit() {
    if (!agreed || !agreedNotAffiliated) return;
    setError("");
    setPhase("submitting");
    setStatusMessage("Sending your data to the server...");
    trackEvent(ANALYTICS_EVENTS.submitOpenedMdac, { method: "passthrough" });

    try {
      const payload = mapFormToMdac(data, cityCode);
      const r = await fetch(`${PASSTHROUGH_URL}/api/auto-submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await r.json()) as { success: boolean; jobId?: string; error?: string };
      if (!r.ok || !json.success || !json.jobId) {
        setError(json.error || `Server returned ${r.status}`);
        setPhase("failed");
        return;
      }
      setJobId(json.jobId);
      try {
        sessionStorage.setItem("mdac_last_job_id", json.jobId);
      } catch {
        // sessionStorage may be disabled — non-fatal
      }
      startPolling(json.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setPhase("failed");
    }
  }

  async function handleRetrieve() {
    if (!pin.trim()) return;
    setError("");
    setPhase("retrieving");
    setStatusMessage("Fetching your QR code from the official MDAC site...");
    trackEvent(ANALYTICS_EVENTS.userConfirmedSubmitted, { method: "passthrough" });

    try {
      const r = await fetch(`${PASSTHROUGH_URL}/api/jobs/${jobId}/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const json = (await r.json()) as { success: boolean; error?: string };
      if (!r.ok || !json.success) {
        setError(json.error || `Server returned ${r.status}`);
        setPhase("failed");
        return;
      }
      startPolling(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setPhase("failed");
    }
  }

  return (
    <div className="step-enter space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
        <div>
          <h3 className="text-base font-bold text-gray-900">File your MDAC</h3>
          <p className="text-sm text-gray-500 mt-1">
            We&apos;ll fill out the official Malaysian arrival card form for you.
            You&apos;ll get the official QR code by email when it&apos;s done.
          </p>
        </div>

        {phase === "intro" && (
          <>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">
                Heads up — read this before you click
              </p>
              <ul className="text-sm text-amber-900 space-y-1.5 list-disc list-inside">
                <li>
                  This is a <strong>third-party service</strong>. We are not affiliated with
                  the Malaysian government or the official MDAC site.
                </li>
                <li>
                  We file by <strong>automating</strong> the official form on your behalf.
                  Filing the MDAC yourself directly is always free at{" "}
                  <a
                    className="underline"
                    href="https://imigresen-online.imi.gov.my/mdac/main"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    imigresen-online.imi.gov.my
                  </a>
                  .
                </li>
                <li>
                  Your data is held only long enough to file and retrieve the QR.
                  Nothing is stored on our servers afterwards.
                </li>
                <li>
                  This is an MVP. If filing fails, we&apos;ll email you so you can file
                  manually before your trip.
                </li>
              </ul>
            </div>

            <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#003893] focus:ring-[#003893]"
              />
              <span>
                I understand this is a third-party service and that I could file the MDAC
                myself for free at the official site.
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedNotAffiliated}
                onChange={(e) => setAgreedNotAffiliated(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#003893] focus:ring-[#003893]"
              />
              <span>
                I confirm the information I&apos;ve entered is accurate and I authorize
                this service to submit it to the official MDAC system on my behalf.
              </span>
            </label>

            {resolvingCity && (
              <p className="text-xs text-gray-400">Looking up your city code with MDAC...</p>
            )}
          </>
        )}

        {(phase === "submitting" || phase === "retrieving") && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 border-3 border-[#003893] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-700 font-medium">{statusMessage}</p>
            <p className="text-xs text-gray-400">
              This usually takes 30–90 seconds. Don&apos;t close this tab.
            </p>
          </div>
        )}

        {phase === "submitted" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-900">Submitted to MDAC ✓</p>
              <p className="text-sm text-green-900 mt-1">
                Check the email inbox for <strong>{data.email}</strong> — the official MDAC
                site has sent you a PIN. Enter it below to retrieve your QR code.
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                MDAC PIN
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter the PIN from your email"
                className="w-full rounded-xl border-2 px-4 py-3 text-base font-mono tracking-wider border-gray-200 focus:border-[#003893] focus:outline-none"
                maxLength={12}
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">
                Don&apos;t see the email? Check spam, or wait a minute — sometimes MDAC is slow.
              </p>
            </div>
          </div>
        )}

        {phase === "failed" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
            <p className="text-sm font-semibold text-red-900">Something went wrong</p>
            <p className="text-sm text-red-900">{error || "Unknown error"}</p>
            <p className="text-xs text-red-900">
              You can try again, or file directly at{" "}
              <a
                className="underline"
                href="https://imigresen-online.imi.gov.my/mdac/main"
                target="_blank"
                rel="noopener noreferrer"
              >
                imigresen-online.imi.gov.my
              </a>
              .
            </p>
          </div>
        )}

        {jobId && (phase === "submitting" || phase === "retrieving") && (
          <p className="text-xs text-gray-400 font-mono break-all">Job: {jobId}</p>
        )}
        {jobId && (phase === "submitted" || phase === "failed" || phase === "done") && (
          <DebugBundlePanel jobId={jobId} />
        )}
      </div>

      <div className="flex gap-3">
        {phase === "intro" && (
          <>
            <button
              onClick={onBack}
              className="flex-1 bg-white border-2 border-gray-200 text-gray-700 font-semibold text-sm py-3 rounded-xl transition-all active:scale-95"
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={!agreed || !agreedNotAffiliated}
              className="flex-1 bg-[#003893] text-white font-semibold text-sm py-3 rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              File MDAC for me
            </button>
          </>
        )}
        {phase === "submitted" && (
          <>
            <button
              onClick={() => setPhase("intro")}
              className="flex-1 bg-white border-2 border-gray-200 text-gray-700 font-semibold text-sm py-3 rounded-xl transition-all active:scale-95"
            >
              Cancel
            </button>
            <button
              onClick={handleRetrieve}
              disabled={!pin.trim()}
              className="flex-1 bg-[#003893] text-white font-semibold text-sm py-3 rounded-xl transition-all active:scale-95 disabled:opacity-50"
            >
              Get my QR
            </button>
          </>
        )}
        {phase === "failed" && (
          <>
            <button
              onClick={onBack}
              className="flex-1 bg-white border-2 border-gray-200 text-gray-700 font-semibold text-sm py-3 rounded-xl transition-all active:scale-95"
            >
              Back
            </button>
            <button
              onClick={() => {
                setError("");
                setPhase("intro");
              }}
              className="flex-1 bg-[#003893] text-white font-semibold text-sm py-3 rounded-xl transition-all active:scale-95"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Debug-bundle utility shown after a job lands in submitted/failed/done.
 * Pulls GET /api/jobs/:id/debug and offers Download (file) + Copy (clipboard).
 * Used to ship debug data back when something goes wrong on a real run.
 */
function DebugBundlePanel({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState<"download" | "copy" | null>(null);
  const [msg, setMsg] = useState<string>("");

  async function fetchBundle(): Promise<unknown | null> {
    try {
      const r = await fetch(`${PASSTHROUGH_URL}/api/jobs/${jobId}/debug`);
      if (!r.ok) {
        setMsg(`Server returned ${r.status}`);
        return null;
      }
      return (await r.json()) as unknown;
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Network error");
      return null;
    }
  }

  async function handleDownload() {
    setBusy("download");
    setMsg("");
    const bundle = await fetchBundle();
    if (!bundle) {
      setBusy(null);
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mdac-debug-${jobId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg("Downloaded — send the .json file back for analysis.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy() {
    setBusy("copy");
    setMsg("");
    const bundle = await fetchBundle();
    if (!bundle) {
      setBusy(null);
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle));
      setMsg("Copied to clipboard.");
    } catch {
      setMsg("Couldn't copy — use Download instead.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <summary className="text-xs font-semibold text-gray-600 cursor-pointer select-none">
        Debug bundle (for the developer)
      </summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-gray-500">
          Job ID: <span className="font-mono break-all">{jobId}</span>
        </p>
        <p className="text-xs text-gray-500">
          If something went wrong, download the debug file (timeline + screenshots
          of what the bot saw) and send it back. Available for 24 hours.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            disabled={busy !== null}
            className="flex-1 text-xs font-semibold bg-white border border-gray-300 text-gray-700 py-2 rounded-lg active:scale-95 disabled:opacity-50"
          >
            {busy === "download" ? "Downloading..." : "Download .json"}
          </button>
          <button
            onClick={handleCopy}
            disabled={busy !== null}
            className="flex-1 text-xs font-semibold bg-white border border-gray-300 text-gray-700 py-2 rounded-lg active:scale-95 disabled:opacity-50"
          >
            {busy === "copy" ? "Copying..." : "Copy JSON"}
          </button>
        </div>
        {msg && <p className="text-xs text-gray-600">{msg}</p>}
      </div>
    </details>
  );
}
