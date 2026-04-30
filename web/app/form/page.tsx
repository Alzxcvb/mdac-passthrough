"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PersonalStep from "@/components/PersonalStep";
import TravelStep from "@/components/TravelStep";
import ReviewStep from "@/components/ReviewStep";
import SubmitStep from "@/components/SubmitStep";
import StepIndicator from "@/components/StepIndicator";
import { FormData, EMPTY_FORM } from "@/lib/types";
import {
  saveProfile,
  saveDraft,
  clearDraft,
  buildNewFormFromProfile,
  loadDraft,
  saveStep,
  loadStep,
} from "@/lib/storage";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";

function FormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");

  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData>({ ...EMPTY_FORM });
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);

    // If there's an in-flight draft past step 1, always restore it — mode
    // params come from fresh navigations, not reloads, so an existing draft
    // with a saved step means the user reloaded mid-flow.
    const existingDraft = loadDraft();
    const savedStep = loadStep();
    if (existingDraft && savedStep && savedStep > 1) {
      setFormData(existingDraft);
      setStep(savedStep);
      return;
    }

    if (mode === "saved") {
      const prefilled = buildNewFormFromProfile();
      setFormData(prefilled);
    } else if (mode === "trip") {
      const draftJson = sessionStorage.getItem("mdac_trip_draft");
      if (draftJson) {
        try {
          const parsed = JSON.parse(draftJson) as FormData;
          setFormData(parsed);
          saveDraft(parsed);
          sessionStorage.removeItem("mdac_trip_draft");
        } catch {
          setFormData({ ...EMPTY_FORM });
        }
      } else {
        setFormData({ ...EMPTY_FORM });
      }
    } else if (existingDraft) {
      setFormData(existingDraft);
    } else {
      setFormData({ ...EMPTY_FORM });
    }
  }, [mode, initialized, searchParams]);

  const handleChange = useCallback((updates: Partial<FormData>) => {
    setFormData((prev) => {
      const next = { ...prev, ...updates };
      saveDraft(next);
      return next;
    });
  }, []);

  const handleNext = useCallback(() => {
    if (step === 1) {
      trackEvent(ANALYTICS_EVENTS.step1Complete, {
        mode: mode ?? "draft",
      });
    } else if (step === 2) {
      trackEvent(ANALYTICS_EVENTS.step2Complete, {
        mode: mode ?? "draft",
        transport: formData.modeOfTransport || "unknown",
      });
    }
    setStep((s) => {
      const next = s + 1;
      saveStep(next);
      return next;
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [formData.modeOfTransport, mode, step]);

  const handleBack = useCallback(() => {
    setStep((s) => {
      const next = s - 1;
      saveStep(next);
      return next;
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Called when ReviewStep submits — save profile, advance to submit step.
  // Draft stays in localStorage until actual submission succeeds so that
  // reloads / desktop-view switches on step 4 don't wipe the user's data.
  const handleReviewSubmit = useCallback(() => {
    trackEvent(ANALYTICS_EVENTS.step3ReviewSubmit, {
      save_profile: formData.saveProfile,
      transport: formData.modeOfTransport || "unknown",
    });
    if (formData.saveProfile) {
      saveProfile(formData);
    }
    setStep(4);
    saveStep(4);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [formData]);

  const handleSubmitSuccess = useCallback(
    (payload: { qrImageBase64?: string; pdfBase64?: string }) => {
      sessionStorage.setItem(
        "mdac_confirmation",
        JSON.stringify({ form: formData, ...payload })
      );
      clearDraft();
      router.push("/confirmation?submitted=true");
    },
    [formData, router]
  );

  if (!initialized) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#003893] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <StepIndicator
        currentStep={step}
        totalSteps={4}
        labels={["Personal", "Travel", "Review", "Submit"]}
      />

      <div className="px-6 py-6 max-w-lg mx-auto">
        {step === 1 && (
          <PersonalStep data={formData} onChange={handleChange} onNext={handleNext} />
        )}
        {step === 2 && (
          <TravelStep
            data={formData}
            onChange={handleChange}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}
        {step === 3 && (
          <ReviewStep
            data={formData}
            onChange={handleChange}
            onSubmit={handleReviewSubmit}
            onBack={handleBack}
          />
        )}
        {step === 4 && (
          <SubmitStep
            data={formData}
            onSuccess={handleSubmitSuccess}
            onBack={() => {
              setStep(3);
              saveStep(3);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}
      </div>
    </>
  );
}

export default function FormPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-[#003893] text-white px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push("/")}
          className="p-1 rounded-lg hover:bg-white/10 transition-colors"
          aria-label="Go back"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <p className="text-sm font-semibold">Malaysia Arrival Card</p>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#003893] border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <FormContent />
      </Suspense>
    </main>
  );
}
