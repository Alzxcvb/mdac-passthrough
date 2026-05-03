"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormData } from "@/lib/types";
import { getSessionId } from "@/lib/telemetry";

const PASSTHROUGH_URL = process.env.NEXT_PUBLIC_PASSTHROUGH_URL || "";

interface Stored {
  form: FormData;
  qrImageBase64?: string;
  pdfBase64?: string;
  jobId?: string;
}

function ConfirmationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const submitted = searchParams.get("submitted") === "true";

  const [data, setData] = useState<Stored | null>(null);
  const [jobId, setJobId] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("mdac_confirmation");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Stored;
        setData(parsed);
        if (parsed.jobId) setJobId(parsed.jobId);
      } catch {
        setData(null);
      }
    }
    if (!jobId) {
      const lastId = sessionStorage.getItem("mdac_last_job_id");
      if (lastId) setJobId(lastId);
    }
    setHydrated(true);
    // jobId intentionally omitted — we only want the initial hydration read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#003893] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-6 py-10 max-w-lg mx-auto text-center space-y-4">
        <p className="text-gray-700">No confirmation found in this session.</p>
        <button
          onClick={() => router.push("/")}
          className="px-4 py-2 bg-[#003893] text-white text-sm rounded-xl"
        >
          Go home
        </button>
      </div>
    );
  }

  const downloadPdf = () => {
    if (!data.pdfBase64) return;
    const blob = base64ToBlob(data.pdfBase64, "application/pdf");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mdac-${data.form.fullName.replace(/\s+/g, "_")}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="bg-[#003893] text-white px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push("/")}
          className="p-1 rounded-lg hover:bg-white/10"
          aria-label="Home"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7m-9 2v8a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 012-2h2a2 2 0 002 2v2a2 2 0 002 2h2a2 2 0 002-2v-8" />
          </svg>
        </button>
        <p className="text-sm font-semibold flex-1">Your MDAC is filed</p>
      </div>

      <div className="px-6 py-6 max-w-lg mx-auto space-y-5">
        {submitted && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-bold text-green-900">All done ✓</p>
            <p className="text-sm text-green-900 mt-1">
              The official MDAC has been filed and your QR code is below.
              Save or screenshot it — you&apos;ll show this on arrival.
            </p>
          </div>
        )}

        {data.qrImageBase64 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3 text-center">
            <p className="text-sm font-semibold text-gray-900">Official MDAC QR</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${data.qrImageBase64}`}
              alt="MDAC QR Code"
              className="mx-auto max-w-full rounded-lg border border-gray-200"
            />
            <p className="text-xs text-gray-500">
              Travelling to {data.form.cityInMalaysia || "Malaysia"} on{" "}
              {data.form.arrivalDate} — show this at the immigration counter.
            </p>
          </div>
        ) : data.pdfBase64 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3 text-center">
            <p className="text-sm font-semibold text-gray-900">Official MDAC PDF</p>
            <p className="text-xs text-gray-500">
              The MDAC site returned your confirmation as a PDF. Download it below.
            </p>
            <button
              onClick={downloadPdf}
              className="w-full bg-[#003893] text-white font-semibold text-sm py-3 rounded-xl active:scale-95"
            >
              Download PDF
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">
              Submission was logged but the QR didn&apos;t come through. Check your
              email — if there&apos;s a PIN, you can still retrieve your QR
              directly from{" "}
              <a
                className="underline"
                href="https://imigresen-online.imi.gov.my/mdac/main"
                target="_blank"
                rel="noopener noreferrer"
              >
                the MDAC site
              </a>
              .
            </p>
          </div>
        )}

        <DebugBundlePanel jobId={jobId} />

        <div className="text-center">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-gray-500 underline"
          >
            File another arrival card
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * Confirmation-page variant of the debug panel: always exposes the session
 * ID, plus the per-job debug bundle when a jobId is recoverable from
 * sessionStorage. Mirrors the SubmitStep panel intentionally — kept inline
 * here so this page can be served independently.
 */
function DebugBundlePanel({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState<"download" | "copy" | "session" | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [sessionId, setSessionIdLocal] = useState<string>("");

  useEffect(() => {
    setSessionIdLocal(getSessionId());
  }, []);

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
    if (!jobId) return;
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
    if (!jobId) return;
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

  async function handleCopySession() {
    if (!sessionId) return;
    setBusy("session");
    setMsg("");
    const id = jobId ? `session=${sessionId} job=${jobId}` : `session=${sessionId}`;
    try {
      await navigator.clipboard.writeText(id);
      setMsg("Copied — paste this when reporting an issue.");
    } catch {
      setMsg(`Couldn't copy — your session id is: ${sessionId}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <summary className="text-xs font-semibold text-gray-600 cursor-pointer select-none">
        Debug info (for the developer)
      </summary>
      <div className="mt-3 space-y-3">
        <div className="space-y-1">
          <p className="text-xs text-gray-500">
            Session ID:{" "}
            <span className="font-mono break-all">{sessionId || "—"}</span>
          </p>
          {jobId && (
            <p className="text-xs text-gray-500">
              Job ID: <span className="font-mono break-all">{jobId}</span>
            </p>
          )}
        </div>
        <button
          onClick={handleCopySession}
          disabled={busy !== null || !sessionId}
          className="w-full text-xs font-semibold bg-white border border-gray-300 text-gray-700 py-2 rounded-lg active:scale-95 disabled:opacity-50"
        >
          {busy === "session" ? "Copying..." : "Copy session ID"}
        </button>
        {jobId && (
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
        )}
        {msg && <p className="text-xs text-gray-600">{msg}</p>}
      </div>
    </details>
  );
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function ConfirmationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#003893] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ConfirmationContent />
    </Suspense>
  );
}
