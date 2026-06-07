"use client";

import { useState, useEffect } from "react";
import { type FormData } from "@/lib/types";
import { COUNTRIES, NATIONALITIES, resolveCountryName } from "@/lib/mdac-codes";

function parseDOB(value: string): { day: string; month: string; year: string } {
  if (!value) return { day: "", month: "", year: "" };
  const [y, m, d] = value.split("-");
  return { day: String(parseInt(d || "0", 10)), month: String(parseInt(m || "0", 10)), year: y || "" };
}

interface Props {
  data: FormData;
  onChange: (updates: Partial<FormData>) => void;
  onNext: () => void;
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
}

function Field({ label, hint, children, required }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-[#CC0001] ml-1">*</span>}
      </label>
      {hint && <p className="text-xs text-gray-400 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

export default function PersonalStep({ data, onChange, onNext }: Props) {
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [natSearch, setNatSearch] = useState(data.nationality);
  const [showNatDropdown, setShowNatDropdown] = useState(false);
  const [pobSearch, setPobSearch] = useState(data.placeOfBirth);
  const [showPobDropdown, setShowPobDropdown] = useState(false);
  const [dob, setDob] = useState(() => parseDOB(data.dateOfBirth));
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [scanError, setScanError] = useState("");

  const handlePassportScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanState("scanning");
    setScanError("");

    try {
      const form = new FormData();
      form.append("image", file);

      const res = await fetch("/api/scan-passport", { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Scan failed");
      }

      const d = json.data;
      const updates: Partial<FormData> = {};
      if (d.fullName) updates.fullName = d.fullName;
      if (d.passportNumber) updates.passportNumber = d.passportNumber;
      if (d.nationality) {
        const nationality = resolveCountryName(d.nationality);
        updates.nationality = nationality;
        setNatSearch(nationality);
      }
      if (d.dateOfBirth) {
        updates.dateOfBirth = d.dateOfBirth;
        setDob(parseDOB(d.dateOfBirth));
      }
      if (d.sex === "Male" || d.sex === "Female") updates.sex = d.sex;
      if (d.passportExpiry) updates.passportExpiry = d.passportExpiry;
      if (d.countryOfIssuance) updates.countryOfPassportIssuance = resolveCountryName(d.countryOfIssuance);
      if (d.placeOfBirth) {
        const placeOfBirth = resolveCountryName(d.placeOfBirth);
        updates.placeOfBirth = placeOfBirth;
        setPobSearch(placeOfBirth);
      }
      if (d.passportType === "Ordinary" || d.passportType === "Official" || d.passportType === "Diplomatic") {
        updates.passportType = d.passportType;
      }

      onChange(updates);
      setScanState("done");
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
      setScanState("error");
    }
  };

  // Sync dob state → form state whenever any part changes
  useEffect(() => {
    if (dob.day && dob.month && dob.year && dob.year.length === 4) {
      const mm = String(parseInt(dob.month)).padStart(2, "0");
      const dd = String(parseInt(dob.day)).padStart(2, "0");
      onChange({ dateOfBirth: `${dob.year}-${mm}-${dd}` });
    } else if (!dob.day && !dob.month && !dob.year) {
      onChange({ dateOfBirth: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dob]);


  const filteredNats = NATIONALITIES.filter((n) =>
    n.toLowerCase().includes(natSearch.toLowerCase())
  );
  const filteredPobs = COUNTRIES.filter((country) =>
    country.toLowerCase().includes(pobSearch.toLowerCase())
  );

  const validate = () => {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!data.fullName.trim()) e.fullName = "Full name is required";
    if (!data.passportNumber.trim()) e.passportNumber = "Passport number is required";
    if (!data.nationality) e.nationality = "Please select your nationality";
    if (!data.dateOfBirth) e.dateOfBirth = "Date of birth is required";
    if (!data.sex) e.sex = "Please select your sex";
    if (!data.passportType) e.passportType = "Please select passport type";
    if (!data.countryOfPassportIssuance.trim()) e.countryOfPassportIssuance = "Country of issuance is required";
    if (!data.placeOfBirth.trim()) e.placeOfBirth = "Place of birth is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (validate()) onNext();
  };

  const inputClass = (field: keyof FormData) =>
    `w-full px-4 py-3 rounded-xl border text-base bg-white transition-colors outline-none focus:ring-2 focus:ring-[#003893]/20 focus:border-[#003893] ${
      errors[field] ? "border-red-400 bg-red-50" : "border-gray-200"
    }`;

  return (
    <div className="step-enter space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Personal Information</h2>
        <p className="text-sm text-gray-500 mt-1">As it appears in your passport</p>
      </div>

      {/* Passport Scan */}
      <div className={`rounded-2xl border-2 border-dashed p-4 text-center transition-colors ${
        scanState === "done" ? "border-green-300 bg-green-50" :
        scanState === "error" ? "border-red-300 bg-red-50" :
        scanState === "scanning" ? "border-[#003893] bg-blue-50" :
        "border-gray-200 bg-gray-50"
      }`}>
        {scanState === "scanning" ? (
          <div className="flex items-center justify-center gap-2 py-2">
            <div className="w-5 h-5 border-2 border-[#003893] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-medium text-[#003893]">Reading passport...</span>
          </div>
        ) : scanState === "done" ? (
          <div className="py-1">
            <p className="text-sm font-semibold text-green-700">Passport scanned — fields populated below</p>
            <button
              type="button"
              onClick={() => setScanState("idle")}
              className="text-xs text-green-600 underline mt-1"
            >Scan again</button>
          </div>
        ) : (
          <>
            <label className="cursor-pointer block">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePassportScan}
              />
              <div className="flex flex-col items-center gap-2 py-2">
                <svg className="w-8 h-8 text-[#003893]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <circle cx="12" cy="13" r="3" strokeWidth={1.5} />
                </svg>
                <span className="text-sm font-semibold text-[#003893]">Scan Passport Photo</span>
                <span className="text-xs text-gray-400">Take a photo or upload — auto-fills all fields</span>
              </div>
            </label>
            {scanState === "error" && (
              <p className="text-xs text-red-500 mt-2">{scanError}. You can fill in the fields manually below.</p>
            )}
          </>
        )}
      </div>

      {/* Full Name */}
      <Field label="Full Name" hint="Exactly as shown in your passport" required>
        <input
          type="text"
          className={inputClass("fullName")}
          value={data.fullName}
          onChange={(e) => {
            onChange({ fullName: e.target.value });
            if (errors.fullName) setErrors({ ...errors, fullName: undefined });
          }}
          placeholder="e.g. JOHN SMITH"
          autoCapitalize="characters"
          autoComplete="name"
        />
        {errors.fullName && (
          <p className="text-xs text-red-500 mt-1">{errors.fullName}</p>
        )}
      </Field>

      {/* Passport Number */}
      <Field label="Passport Number" required>
        <input
          type="text"
          className={inputClass("passportNumber")}
          value={data.passportNumber}
          onChange={(e) => {
            onChange({ passportNumber: e.target.value.toUpperCase() });
            if (errors.passportNumber) setErrors({ ...errors, passportNumber: undefined });
          }}
          placeholder="e.g. A12345678"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
        {errors.passportNumber && (
          <p className="text-xs text-red-500 mt-1">{errors.passportNumber}</p>
        )}
      </Field>

      {/* Nationality — searchable */}
      <Field label="Nationality" required>
        <div className="relative">
          <input
            type="text"
            className={`${inputClass("nationality")} pr-10`}
            value={natSearch}
            onChange={(e) => {
              setNatSearch(e.target.value);
              onChange({ nationality: "" });
              setShowNatDropdown(true);
              if (errors.nationality) setErrors({ ...errors, nationality: undefined });
            }}
            onFocus={() => setShowNatDropdown(true)}
            onBlur={() => setTimeout(() => setShowNatDropdown(false), 150)}
            placeholder="Type to search..."
            autoComplete="off"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          {showNatDropdown && filteredNats.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
              {filteredNats.map((nat) => (
                <button
                  key={nat}
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 hover:text-[#003893] transition-colors first:rounded-t-xl last:rounded-b-xl"
                  onMouseDown={() => {
                    onChange({ nationality: nat });
                    setNatSearch(nat);
                    setShowNatDropdown(false);
                    setErrors({ ...errors, nationality: undefined });
                  }}
                >
                  {nat}
                </button>
              ))}
            </div>
          )}
        </div>
        {errors.nationality && (
          <p className="text-xs text-red-500 mt-1">{errors.nationality}</p>
        )}
      </Field>

      {/* Date of Birth */}
      <Field label="Date of Birth" hint="DD / MM / YYYY" required>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="DD"
              className={`${inputClass("dateOfBirth")} text-center`}
              value={dob.day}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                setDob((prev) => ({ ...prev, day: val }));
                if (errors.dateOfBirth) setErrors({ ...errors, dateOfBirth: undefined });
              }}
            />
          </div>
          <div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="MM"
              className={`${inputClass("dateOfBirth")} text-center`}
              value={dob.month}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                setDob((prev) => ({ ...prev, month: val }));
                if (errors.dateOfBirth) setErrors({ ...errors, dateOfBirth: undefined });
              }}
            />
          </div>
          <div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="YYYY"
              className={`${inputClass("dateOfBirth")} text-center`}
              value={dob.year}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                setDob((prev) => ({ ...prev, year: val }));
                if (errors.dateOfBirth) setErrors({ ...errors, dateOfBirth: undefined });
              }}
            />
          </div>
        </div>
        {errors.dateOfBirth && (
          <p className="text-xs text-red-500 mt-1">{errors.dateOfBirth}</p>
        )}
      </Field>

      {/* Sex */}
      <Field label="Sex" required>
        <div className="flex gap-3">
          {(["Male", "Female"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange({ sex: option });
                if (errors.sex) setErrors({ ...errors, sex: undefined });
              }}
              className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                data.sex === option
                  ? "border-[#003893] bg-[#003893] text-white"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        {errors.sex && <p className="text-xs text-red-500 mt-1">{errors.sex}</p>}
      </Field>

      {/* Passport Type */}
      <Field label="Passport Type" required>
        <div className="flex gap-2">
          {(["Ordinary", "Official", "Diplomatic"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange({ passportType: option });
                if (errors.passportType) setErrors({ ...errors, passportType: undefined });
              }}
              className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                data.passportType === option
                  ? "border-[#003893] bg-[#003893] text-white"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        {errors.passportType && <p className="text-xs text-red-500 mt-1">{errors.passportType}</p>}
      </Field>

      {/* Country of Passport Issuance */}
      <Field label="Country of Passport Issuance" required>
        <input
          type="text"
          className={inputClass("countryOfPassportIssuance")}
          value={data.countryOfPassportIssuance}
          onChange={(e) => {
            onChange({ countryOfPassportIssuance: e.target.value });
            if (errors.countryOfPassportIssuance) setErrors({ ...errors, countryOfPassportIssuance: undefined });
          }}
          placeholder="e.g. United States"
          autoComplete="country-name"
        />
        {errors.countryOfPassportIssuance && (
          <p className="text-xs text-red-500 mt-1">{errors.countryOfPassportIssuance}</p>
        )}
      </Field>

      {/* Place of Birth */}
      <Field label="Place of Birth (Country)" required>
        <div className="relative">
          <input
            type="text"
            className={`${inputClass("placeOfBirth")} pr-10`}
            value={pobSearch}
            onChange={(e) => {
              setPobSearch(e.target.value);
              onChange({ placeOfBirth: "" });
              setShowPobDropdown(true);
              if (errors.placeOfBirth) setErrors({ ...errors, placeOfBirth: undefined });
            }}
            onFocus={() => setShowPobDropdown(true)}
            onBlur={() => setTimeout(() => setShowPobDropdown(false), 150)}
            placeholder="Type to search..."
            autoComplete="off"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          {showPobDropdown && filteredPobs.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
              {filteredPobs.map((country) => (
                <button
                  key={country}
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 hover:text-[#003893] transition-colors first:rounded-t-xl last:rounded-b-xl"
                  onMouseDown={() => {
                    onChange({ placeOfBirth: country });
                    setPobSearch(country);
                    setShowPobDropdown(false);
                    setErrors({ ...errors, placeOfBirth: undefined });
                  }}
                >
                  {country}
                </button>
              ))}
            </div>
          )}
        </div>
        {errors.placeOfBirth && (
          <p className="text-xs text-red-500 mt-1">{errors.placeOfBirth}</p>
        )}
      </Field>

      <button
        onClick={handleNext}
        className="w-full bg-[#CC0001] hover:bg-red-700 text-white font-semibold text-base py-4 rounded-2xl transition-all active:scale-95 mt-2"
      >
        Next: Travel Details
      </button>
    </div>
  );
}
