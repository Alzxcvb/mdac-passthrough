"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";

export default function LandingPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const startFiling = () => {
    trackEvent(ANALYTICS_EVENTS.formStarted, { source: "landing" });
    if (email.trim()) {
      try {
        sessionStorage.setItem("mdac_intent_email", email.trim());
      } catch {
        // localStorage unavailable; ignore
      }
    }
    router.push("/form");
  };

  const captureEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
    trackEvent("email_captured", { has_email: true });
    setTimeout(startFiling, 300);
  };

  return (
    <main className="min-h-screen bg-white">
      {/* Hero */}
      <section className="bg-[#003893] text-white px-6 py-12">
        <div className="max-w-lg mx-auto space-y-4">
          <p className="text-xs font-bold tracking-widest text-amber-300 uppercase">
            Third-party MDAC filer
          </p>
          <h1 className="text-3xl font-bold leading-tight">
            We file your Malaysia arrival card for you.
          </h1>
          <p className="text-base text-blue-100 leading-relaxed">
            Enter your trip details once. We handle the form, the slider CAPTCHA,
            and email-PIN dance. You get the official QR.
          </p>
          <p className="text-sm text-blue-200">
            Works on any phone. No app to install. No copy-paste.
          </p>
        </div>
      </section>

      {/* CTA / email capture */}
      <section className="px-6 py-8 max-w-lg mx-auto space-y-4">
        <form onSubmit={captureEmail} className="space-y-3">
          <label className="block text-sm font-semibold text-gray-700">
            Email (we&apos;ll only use it if filing fails so we can warn you in time)
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base focus:border-[#003893] focus:outline-none"
          />
          <button
            type="submit"
            disabled={submitted}
            className="w-full bg-[#003893] text-white font-semibold text-base py-3.5 rounded-xl active:scale-95 disabled:opacity-50"
          >
            {submitted ? "Loading..." : "Start filing →"}
          </button>
        </form>
        <button
          onClick={startFiling}
          className="w-full text-sm text-gray-500 underline"
        >
          Skip — just take me to the form
        </button>
      </section>

      {/* Gray-zone disclosure (above the fold-ish, hard to miss) */}
      <section className="px-6 pb-8 max-w-lg mx-auto">
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
            Read this first
          </p>
          <ul className="text-sm text-amber-900 space-y-2 list-disc list-inside">
            <li>
              We&apos;re <strong>not</strong> the Malaysian government. We&apos;re a
              third-party tool that automates the official MDAC site.
            </li>
            <li>
              The MDAC is{" "}
              <a
                className="underline"
                href="https://imigresen-online.imi.gov.my/mdac/main"
                target="_blank"
                rel="noopener noreferrer"
              >
                always free directly
              </a>
              . We exist because the official UX is rough on mobile.
            </li>
            <li>
              Your data is held in memory only long enough to file and retrieve
              the QR — then it&apos;s wiped. We don&apos;t sell or share it.
            </li>
            <li>
              This is an <strong>MVP</strong>. Treat it as best-effort. If filing
              fails, file directly at the link above before your trip.
            </li>
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 pb-12 max-w-lg mx-auto space-y-4">
        <h2 className="text-lg font-bold text-gray-900">How it works</h2>
        <ol className="space-y-3 text-sm text-gray-700">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-[#003893] text-white text-xs font-bold rounded-full flex items-center justify-center">1</span>
            <span>Enter your passport, trip, and accommodation details (3-step form, 2 minutes).</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-[#003893] text-white text-xs font-bold rounded-full flex items-center justify-center">2</span>
            <span>We open the official MDAC site in a server browser, fill the form, and solve the slider CAPTCHA.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-[#003893] text-white text-xs font-bold rounded-full flex items-center justify-center">3</span>
            <span>MDAC emails you a PIN. Type it back here — we use it to retrieve your official QR.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-[#003893] text-white text-xs font-bold rounded-full flex items-center justify-center">4</span>
            <span>Save the QR. Show it at the immigration counter on arrival.</span>
          </li>
        </ol>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-6 text-center space-y-1">
        <p className="text-xs text-gray-400">
          Not affiliated with the Malaysian Immigration Department.
        </p>
        <p className="text-xs text-gray-400">
          Use at your own risk. File at{" "}
          <a
            className="underline"
            href="https://imigresen-online.imi.gov.my/mdac/main"
            target="_blank"
            rel="noopener noreferrer"
          >
            the official site
          </a>{" "}
          if this fails.
        </p>
      </footer>
    </main>
  );
}
