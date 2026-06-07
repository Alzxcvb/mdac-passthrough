"use client";

import { useState } from "react";
import { type FormData } from "@/lib/types";
import { mapFormToIndonesia } from "@/lib/id-codes";

const PASSTHROUGH_URL = process.env.NEXT_PUBLIC_PASSTHROUGH_URL || "";

interface Props {
  data: FormData;
  onSuccess: (payload: { qrImageBase64?: string; pdfBase64?: string; jobId?: string }) => void;
  onBack: () => void;
}

type Phase = "intro" | "filling" | "review" | "submitting" | "done" | "blocked" | "failed";

interface StartResponse {
  success: boolean;
  sessionId?: string;
  submissionId?: string;
  reviewImageBase64?: string;
  error?: string;
}

interface ConfirmResponse {
  success: boolean;
  status: string;
  qrUrl?: string;
  message?: string;
  error?: string;
}

export default function IndonesiaSubmitStep({ data, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [sessionId, setSessionId] = useState("");
  const [reviewImage, setReviewImage] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [agreed, setAgreed] = useState(false);

  async function handleStart() {
    if (!agreed) return;
    setError("");
    setPhase("filling");
    try {
      const traveler = mapFormToIndonesia(data);
      const r = await fetch(`${PASSTHROUGH_URL}/api/id-session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traveler }),
      });
      const json = (await r.json()) as StartResponse;
      if (!r.ok || !json.success || !json.sessionId || !json.reviewImageBase64) {
        setError(json.error || `Server returned ${r.status}`);
        setPhase("failed");
        return;
      }
      setSessionId(json.sessionId);
      setReviewImage(json.reviewImageBase64);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setPhase("failed");
    }
  }

  async function handleConfirm() {
    setError("");
    setPhase("submitting");
    try {
      const r = await fetch(`${PASSTHROUGH_URL}/api/id-session/${sessionId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = (await r.json()) as ConfirmResponse;
      if (json.status === "submitted" && json.qrUrl) {
        setQrUrl(json.qrUrl);
        setPhase("done");
        return;
      }
      if (json.status === "blocked") {
        setMessage(json.message || "Final submit is gated pending a recon pass.");
        setPhase("blocked");
        return;
      }
      setError(json.error || "Submit failed.");
      setPhase("failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setPhase("failed");
    }
  }

  return (
    <div className="step-enter space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
        <div>
          <h3 className="text-base font-bold text-gray-900">
            File your Indonesia Arrival Card{" "}
            <span className="ml-1 align-middle text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
              Beta
            </span>
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            We fill the official All-Indonesia form for you, then show you a screenshot to
            review before anything is submitted. You authorize the final submit.
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
                  This is a <strong>third-party service</strong>, not affiliated with the
                  Indonesian government. Filing yourself is always free at{" "}
                  <a
                    className="underline"
                    href="https://allindonesia.imigrasi.go.id/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    allindonesia.imigrasi.go.id
                  </a>
                  .
                </li>
                <li>
                  We fill the form on a server, then show you a screenshot. Nothing is
                  submitted until you review it and authorize.
                </li>
                <li>Your data is held only long enough to fill and submit. Nothing is stored after.</li>
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
                I understand this is a third-party service and that I could file the
                Indonesia arrival card myself for free.
              </span>
            </label>
          </>
        )}

        {phase === "filling" && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 border-3 border-[#003893] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-700 font-medium">Filling the official form...</p>
            <p className="text-xs text-gray-400">This usually takes 30–60 seconds. Don&apos;t close this tab.</p>
          </div>
        )}

        {phase === "review" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-900">Filled — review before submitting</p>
              <p className="text-sm text-green-900 mt-1">
                Here&apos;s the filled declaration page. Check it, then authorize the submit.
              </p>
            </div>
            {reviewImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/png;base64,${reviewImage}`}
                alt="Filled Indonesia arrival card declaration page"
                className="w-full rounded-xl border border-gray-200"
              />
            )}
          </div>
        )}

        {phase === "submitting" && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 border-3 border-[#003893] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-700 font-medium">Submitting...</p>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-900">Submitted ✓</p>
              <p className="text-sm text-green-900 mt-1">Your Indonesia arrival card QR is ready.</p>
            </div>
            {qrUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrUrl} alt="Indonesia arrival card QR" className="w-48 h-48 mx-auto" />
            )}
          </div>
        )}

        {phase === "blocked" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
            <p className="text-sm font-semibold text-amber-900">Indonesia filing is in beta</p>
            <p className="text-sm text-amber-900">{message}</p>
            <p className="text-xs text-amber-900">
              Your details were filled through the declaration step. For now, finish and submit
              at{" "}
              <a
                className="underline"
                href="https://allindonesia.imigrasi.go.id/"
                target="_blank"
                rel="noopener noreferrer"
              >
                allindonesia.imigrasi.go.id
              </a>
              .
            </p>
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
                href="https://allindonesia.imigrasi.go.id/"
                target="_blank"
                rel="noopener noreferrer"
              >
                allindonesia.imigrasi.go.id
              </a>
              .
            </p>
          </div>
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
              onClick={handleStart}
              disabled={!agreed}
              className="flex-1 bg-[#003893] text-white font-semibold text-sm py-3 rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Fill my Indonesia card
            </button>
          </>
        )}
        {phase === "review" && (
          <>
            <button
              onClick={() => setPhase("intro")}
              className="flex-1 bg-white border-2 border-gray-200 text-gray-700 font-semibold text-sm py-3 rounded-xl transition-all active:scale-95"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 bg-[#003893] text-white font-semibold text-sm py-3 rounded-xl transition-all active:scale-95"
            >
              Authorize &amp; submit
            </button>
          </>
        )}
        {(phase === "failed" || phase === "blocked") && (
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
                setMessage("");
                setPhase("intro");
              }}
              className="flex-1 bg-[#003893] text-white font-semibold text-sm py-3 rounded-xl transition-all active:scale-95"
            >
              Start over
            </button>
          </>
        )}
      </div>
    </div>
  );
}
