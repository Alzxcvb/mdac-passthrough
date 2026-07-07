"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import PersonalStep from "@/components/PersonalStep";
import SubmitStep from "@/components/SubmitStep";
import { FormData, EMPTY_FORM, PHONE_COUNTRY_CODES, MALAYSIAN_STATES, MODES_OF_TRANSPORT } from "@/lib/types";
import { hasProfile, saveProfile } from "@/lib/storage";
import { NS_TRIP_PRESET, buildNsForm, localISODate, validateNsForm } from "@/lib/ns-preset";

type View = "loading" | "onboard-personal" | "onboard-contact" | "ready";

function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] || "";
  if (!first) return "traveler";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export default function NsPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("loading");
  const [formData, setFormData] = useState<FormData>({ ...EMPTY_FORM });
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({});
  const [showStayDetails, setShowStayDetails] = useState(false);

  useEffect(() => {
    if (hasProfile()) {
      setFormData(buildNsForm());
      setView("ready");
    } else {
      setFormData({
        ...EMPTY_FORM,
        ...NS_TRIP_PRESET,
        arrivalDate: localISODate(0),
        departureDate: localISODate(30),
        saveProfile: true,
      });
      setView("onboard-personal");
    }
  }, []);

  // Deliberately no saveDraft() here — drafts belong to the /form wizard and
  // writing them from /ns would hijack its reload-restore logic.
  const handleChange = useCallback((updates: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleContactSave = () => {
    const errors: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(formData.email)) errors.email = "Enter a valid email";
    if (!formData.phoneNumber.trim()) errors.phoneNumber = "Phone number is required";
    if (!formData.passportExpiry) errors.passportExpiry = "Passport expiry is required";
    setContactErrors(errors);
    if (Object.keys(errors).length > 0) return;

    saveProfile(formData);
    setView("ready");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmitSuccess = useCallback(
    (payload: { qrImageBase64?: string; pdfBase64?: string; jobId?: string }) => {
      saveProfile(formData);
      sessionStorage.setItem(
        "mdac_confirmation",
        JSON.stringify({ form: formData, ...payload })
      );
      router.push("/confirmation?submitted=true");
    },
    [formData, router]
  );

  const missing = view === "ready" ? validateNsForm(formData) : [];

  const inputClass =
    "w-full px-4 py-3 rounded-xl border text-base bg-white transition-colors outline-none focus:ring-2 focus:ring-[#003893]/20 focus:border-[#003893] border-gray-200";

  return (
    <main className="min-h-screen flex flex-col bg-gray-50">
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
          <p className="text-sm font-semibold">MDAC for Network School</p>
          <p className="text-xs text-blue-200">Forest City Marina Hotel preset</p>
        </div>
      </div>

      <div className="px-6 py-6 max-w-lg mx-auto w-full">
        {view === "loading" && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#003893] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {view === "onboard-personal" && (
          <div className="space-y-5">
            <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4">
              <p className="text-sm text-[#003893] font-semibold">One scan, then one tap forever</p>
              <p className="text-sm text-gray-600 mt-1">
                Scan your passport once and we save it on this phone. Every trip after
                that, your Malaysia arrival card is one tap. Hotel and trip details are
                already set for Forest City Marina Hotel and the Singapore land crossing.
              </p>
            </div>
            <PersonalStep
              data={formData}
              onChange={handleChange}
              onNext={() => {
                setView("onboard-contact");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              nextLabel="Next: Contact Details"
            />
          </div>
        )}

        {view === "onboard-contact" && (
          <div className="step-enter space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Contact Details</h2>
              <p className="text-sm text-gray-500 mt-1">
                MDAC emails your QR code here. Saved once, reused every trip.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Email <span className="text-[#CC0001]">*</span>
              </label>
              <input
                type="email"
                className={inputClass}
                value={formData.email}
                onChange={(e) => handleChange({ email: e.target.value })}
                placeholder="you@example.com"
                autoComplete="email"
              />
              {contactErrors.email && (
                <p className="text-xs text-red-500 mt-1">{contactErrors.email}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Phone <span className="text-[#CC0001]">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  className="px-2 py-3 rounded-xl border border-gray-200 bg-white text-base outline-none focus:border-[#003893] max-w-[130px]"
                  value={formData.phoneCountryCode}
                  onChange={(e) => handleChange({ phoneCountryCode: e.target.value })}
                >
                  {PHONE_COUNTRY_CODES.map((entry) => (
                    <option key={`${entry.code}-${entry.country}`} value={entry.code}>
                      {entry.code} {entry.country}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  className={inputClass}
                  value={formData.phoneNumber}
                  onChange={(e) => handleChange({ phoneNumber: e.target.value })}
                  placeholder="123456789"
                  autoComplete="tel-national"
                />
              </div>
              {contactErrors.phoneNumber && (
                <p className="text-xs text-red-500 mt-1">{contactErrors.phoneNumber}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Passport Expiry Date <span className="text-[#CC0001]">*</span>
              </label>
              <input
                type="date"
                className={inputClass}
                value={formData.passportExpiry}
                min={localISODate(0)}
                onChange={(e) => handleChange({ passportExpiry: e.target.value })}
              />
              {contactErrors.passportExpiry && (
                <p className="text-xs text-red-500 mt-1">{contactErrors.passportExpiry}</p>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setView("onboard-personal")}
                className="flex-1 bg-white border-2 border-gray-200 text-gray-700 font-semibold text-sm py-3 rounded-xl transition-all active:scale-95"
              >
                Back
              </button>
              <button
                onClick={handleContactSave}
                className="flex-1 bg-[#CC0001] hover:bg-red-700 text-white font-semibold text-sm py-3 rounded-xl transition-all active:scale-95"
              >
                Save my profile
              </button>
            </div>
          </div>
        )}

        {view === "ready" && (
          <div className="step-enter space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    Welcome back, {firstNameOf(formData.fullName)}
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {formData.passportNumber} · {formData.nationality}
                  </p>
                  <p className="text-sm text-gray-500">
                    {formData.email} · {formData.phoneCountryCode} {formData.phoneNumber}
                  </p>
                </div>
                <button
                  onClick={() => setView("onboard-personal")}
                  className="text-sm font-semibold text-[#003893] underline shrink-0 ml-3"
                >
                  Edit
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              <div>
                <h3 className="text-base font-bold text-gray-900">Your trip</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Preset for Forest City Marina Hotel, arriving by land from Singapore.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Arrival in Malaysia
                  </label>
                  <input
                    type="date"
                    className={inputClass}
                    value={formData.arrivalDate}
                    min={localISODate(0)}
                    max={localISODate(3)}
                    onChange={(e) => handleChange({ arrivalDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Leaving Malaysia
                  </label>
                  <input
                    type="date"
                    className={inputClass}
                    value={formData.departureDate}
                    min={formData.arrivalDate || localISODate(0)}
                    onChange={(e) => handleChange({ departureDate: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400">
                MDAC only accepts arrival dates up to 3 days ahead. File on the day you
                head back from Singapore, or up to 3 days before.
              </p>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Vehicle or Flight Number
                </label>
                <input
                  type="text"
                  className={inputClass}
                  value={formData.flightNumber}
                  onChange={(e) => handleChange({ flightNumber: e.target.value })}
                  placeholder="BUS"
                />
              </div>

              <button
                onClick={() => setShowStayDetails((s) => !s)}
                className="text-sm font-semibold text-[#003893] underline"
              >
                {showStayDetails ? "Hide stay details" : "Staying somewhere else?"}
              </button>

              {showStayDetails && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Hotel Name</label>
                    <input
                      type="text"
                      className={inputClass}
                      value={formData.hotelName}
                      onChange={(e) => handleChange({ hotelName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Address in Malaysia</label>
                    <input
                      type="text"
                      className={inputClass}
                      value={formData.addressInMalaysia}
                      onChange={(e) => handleChange({ addressInMalaysia: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">State</label>
                      <select
                        className={inputClass}
                        value={formData.stateInMalaysia}
                        onChange={(e) => handleChange({ stateInMalaysia: e.target.value })}
                      >
                        {MALAYSIAN_STATES.map((state) => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">City</label>
                      <input
                        type="text"
                        className={inputClass}
                        value={formData.cityInMalaysia}
                        onChange={(e) => handleChange({ cityInMalaysia: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">Postcode</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        className={inputClass}
                        value={formData.postalCode}
                        onChange={(e) => handleChange({ postalCode: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">Transport</label>
                      <select
                        className={inputClass}
                        value={formData.modeOfTransport}
                        onChange={(e) =>
                          handleChange({ modeOfTransport: e.target.value as FormData["modeOfTransport"] })
                        }
                      >
                        {MODES_OF_TRANSPORT.map((mode) => (
                          <option key={mode} value={mode}>{mode}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Arriving From</label>
                    <input
                      type="text"
                      className={inputClass}
                      value={formData.departureCountry}
                      onChange={(e) => handleChange({ departureCountry: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            {missing.length > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-3">
                <p className="text-sm font-semibold text-amber-900">
                  A few details are missing before we can file:
                </p>
                <ul className="text-sm text-amber-900 list-disc list-inside">
                  {missing.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
                <button
                  onClick={() => setView("onboard-personal")}
                  className="w-full bg-[#003893] text-white font-semibold text-sm py-3 rounded-xl transition-all active:scale-95"
                >
                  Complete my profile
                </button>
              </div>
            ) : (
              <SubmitStep
                data={formData}
                onSuccess={handleSubmitSuccess}
                onBack={() => {
                  setView("onboard-personal");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
