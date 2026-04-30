"use client";

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels?: string[];
}

export default function StepIndicator({
  currentStep,
  totalSteps,
  labels = ["Personal", "Travel", "Review"],
}: StepIndicatorProps) {
  return (
    <div className="px-6 py-4 bg-white border-b border-gray-100">
      <div className="flex items-center justify-between max-w-lg mx-auto">
        {Array.from({ length: totalSteps }, (_, i) => {
          const step = i + 1;
          const isComplete = step < currentStep;
          const isCurrent = step === currentStep;

          return (
            <div key={step} className="flex items-center flex-1">
              {/* Step circle */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    isComplete
                      ? "bg-[#003893] text-white"
                      : isCurrent
                      ? "bg-[#CC0001] text-white"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {isComplete ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    step
                  )}
                </div>
                <span
                  className={`mt-1 text-[10px] font-medium ${
                    isCurrent ? "text-[#CC0001]" : isComplete ? "text-[#003893]" : "text-gray-400"
                  }`}
                >
                  {labels[i]}
                </span>
              </div>

              {/* Connector line */}
              {i < totalSteps - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 mt-[-16px] transition-all ${
                    isComplete ? "bg-[#003893]" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
