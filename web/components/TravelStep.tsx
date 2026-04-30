"use client";

import { useState } from "react";
import { type FormData, PHONE_COUNTRY_CODES, MALAYSIAN_STATES } from "@/lib/types";
import { COUNTRIES } from "@/lib/mdac-codes";

interface Props {
  data: FormData;
  onChange: (updates: Partial<FormData>) => void;
  onNext: () => void;
  onBack: () => void;
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

export default function TravelStep({ data, onChange, onNext, onBack }: Props) {
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  // Arrival date limits: today up to 3 days from now
  const today = new Date();
  const minDate = today.toISOString().split("T")[0];
  const maxDate = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const validate = () => {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!data.passportExpiry) e.passportExpiry = "Passport expiry date is required";
    if (!data.email.trim()) {
      e.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      e.email = "Please enter a valid email address";
    }
    if (!data.phoneNumber.trim()) e.phoneNumber = "Phone number is required";
    if (!data.arrivalDate) e.arrivalDate = "Arrival date is required";
    if (!data.departureDate) e.departureDate = "Departure date is required";
    if (!data.modeOfTransport) e.modeOfTransport = "Please select mode of transport";
    if (!data.flightNumber.trim()) e.flightNumber = "Flight or transport number is required";
    if (!data.departureCountry.trim()) e.departureCountry = "Last port of departure is required";
    if (!data.hotelName.trim()) e.hotelName = "Hotel or accommodation name is required";
    if (!data.addressInMalaysia.trim()) e.addressInMalaysia = "Please provide your address in Malaysia";
    if (!data.cityInMalaysia.trim()) e.cityInMalaysia = "City is required";
    if (!data.stateInMalaysia) e.stateInMalaysia = "State is required";
    if (!data.postalCode.trim()) e.postalCode = "Postal code is required";
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

  const selectClass = (field: keyof FormData) =>
    `w-full px-4 py-3 rounded-xl border text-base bg-white transition-colors outline-none focus:ring-2 focus:ring-[#003893]/20 focus:border-[#003893] cursor-pointer ${
      errors[field] ? "border-red-400 bg-red-50" : "border-gray-200"
    }`;

  return (
    <div className="step-enter space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Travel Details</h2>
        <p className="text-sm text-gray-500 mt-1">About this specific trip to Malaysia</p>
      </div>

      {/* Passport Expiry */}
      <Field label="Passport Expiry Date" required>
        <input
          type="date"
          className={inputClass("passportExpiry")}
          value={data.passportExpiry}
          onChange={(e) => {
            onChange({ passportExpiry: e.target.value });
            if (errors.passportExpiry) setErrors({ ...errors, passportExpiry: undefined });
          }}
          min={minDate}
        />
        {errors.passportExpiry && (
          <p className="text-xs text-red-500 mt-1">{errors.passportExpiry}</p>
        )}
      </Field>

      {/* Email */}
      <Field label="Email Address" hint="Confirmation PIN will be sent here" required>
        <input
          type="email"
          className={inputClass("email")}
          value={data.email}
          onChange={(e) => {
            onChange({ email: e.target.value });
            if (errors.email) setErrors({ ...errors, email: undefined });
          }}
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
        />
        {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
      </Field>

      {/* Phone */}
      <Field label="Mobile Phone Number" required>
        <div className="flex gap-2">
          <select
            className="border border-gray-200 rounded-xl px-3 py-3 text-sm bg-white outline-none focus:ring-2 focus:ring-[#003893]/20 focus:border-[#003893] cursor-pointer"
            value={data.phoneCountryCode}
            onChange={(e) => onChange({ phoneCountryCode: e.target.value })}
            style={{ minWidth: "95px" }}
          >
            {PHONE_COUNTRY_CODES.map((c) => (
              <option key={c.country} value={c.code}>
                {c.code} {c.country}
              </option>
            ))}
          </select>
          <input
            type="tel"
            className={`flex-1 px-4 py-3 rounded-xl border text-base bg-white transition-colors outline-none focus:ring-2 focus:ring-[#003893]/20 focus:border-[#003893] ${
              errors.phoneNumber ? "border-red-400 bg-red-50" : "border-gray-200"
            }`}
            value={data.phoneNumber}
            onChange={(e) => {
              onChange({ phoneNumber: e.target.value });
              if (errors.phoneNumber) setErrors({ ...errors, phoneNumber: undefined });
            }}
            placeholder="123456789"
            inputMode="tel"
            autoComplete="tel-national"
          />
        </div>
        {errors.phoneNumber && (
          <p className="text-xs text-red-500 mt-1">{errors.phoneNumber}</p>
        )}
      </Field>

      {/* Arrival Date */}
      <Field label="Date of Arrival in Malaysia" hint="Must be within the next 3 days" required>
        <input
          type="date"
          className={inputClass("arrivalDate")}
          value={data.arrivalDate}
          onChange={(e) => {
            onChange({ arrivalDate: e.target.value });
            if (errors.arrivalDate) setErrors({ ...errors, arrivalDate: undefined });
          }}
          min={minDate}
          max={maxDate}
        />
        {errors.arrivalDate && (
          <p className="text-xs text-red-500 mt-1">{errors.arrivalDate}</p>
        )}
      </Field>

      {/* Departure Date */}
      <Field label="Date of Departure from Malaysia" required>
        <input
          type="date"
          className={inputClass("departureDate")}
          value={data.departureDate}
          onChange={(e) => {
            onChange({ departureDate: e.target.value });
            if (errors.departureDate) setErrors({ ...errors, departureDate: undefined });
          }}
          min={data.arrivalDate || minDate}
        />
        {errors.departureDate && (
          <p className="text-xs text-red-500 mt-1">{errors.departureDate}</p>
        )}
      </Field>

      {/* Mode of Transport */}
      <Field label="Mode of Transport" required>
        <div className="flex gap-3">
          {(["Air", "Land", "Sea"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                onChange({ modeOfTransport: mode });
                if (errors.modeOfTransport) setErrors({ ...errors, modeOfTransport: undefined });
              }}
              className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                data.modeOfTransport === mode
                  ? "border-[#003893] bg-[#003893] text-white"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        {errors.modeOfTransport && (
          <p className="text-xs text-red-500 mt-1">{errors.modeOfTransport}</p>
        )}
      </Field>

      {/* Flight / Transport Number */}
      <Field label="Flight / Ship / Transport Number" required>
        <input
          type="text"
          className={inputClass("flightNumber")}
          value={data.flightNumber}
          onChange={(e) => {
            onChange({ flightNumber: e.target.value });
            if (errors.flightNumber) setErrors({ ...errors, flightNumber: undefined });
          }}
          placeholder="e.g. MH370, AK6123"
          autoCapitalize="characters"
        />
        {errors.flightNumber && (
          <p className="text-xs text-red-500 mt-1">{errors.flightNumber}</p>
        )}
      </Field>

      {/* Country of Last Departure */}
      <Field label="Country of Last Departure" hint="Country you departed from to enter Malaysia" required>
        <select
          className={selectClass("departureCountry")}
          value={data.departureCountry}
          onChange={(e) => {
            onChange({ departureCountry: e.target.value });
            if (errors.departureCountry) setErrors({ ...errors, departureCountry: undefined });
          }}
        >
          <option value="">Select country...</option>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {errors.departureCountry && (
          <p className="text-xs text-red-500 mt-1">{errors.departureCountry}</p>
        )}
      </Field>

      {/* Hotel / Accommodation Name */}
      <Field label="Hotel / Accommodation Name" required>
        <input
          type="text"
          className={inputClass("hotelName")}
          value={data.hotelName}
          onChange={(e) => {
            onChange({ hotelName: e.target.value });
            if (errors.hotelName) setErrors({ ...errors, hotelName: undefined });
          }}
          placeholder="e.g. Mandarin Oriental KL"
        />
        {errors.hotelName && (
          <p className="text-xs text-red-500 mt-1">{errors.hotelName}</p>
        )}
      </Field>

      {/* Address in Malaysia */}
      <Field label="Street Address in Malaysia" required>
        <textarea
          className={`w-full px-4 py-3 rounded-xl border text-base bg-white transition-colors outline-none focus:ring-2 focus:ring-[#003893]/20 focus:border-[#003893] resize-none ${
            errors.addressInMalaysia ? "border-red-400 bg-red-50" : "border-gray-200"
          }`}
          value={data.addressInMalaysia}
          onChange={(e) => {
            onChange({ addressInMalaysia: e.target.value });
            if (errors.addressInMalaysia) setErrors({ ...errors, addressInMalaysia: undefined });
          }}
          placeholder="e.g. Kuala Lumpur City Centre, 50088"
          rows={2}
        />
        {errors.addressInMalaysia && (
          <p className="text-xs text-red-500 mt-1">{errors.addressInMalaysia}</p>
        )}
      </Field>

      {/* City + State + Postal Code */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="City" required>
          <input
            type="text"
            className={inputClass("cityInMalaysia")}
            value={data.cityInMalaysia}
            onChange={(e) => {
              onChange({ cityInMalaysia: e.target.value });
              if (errors.cityInMalaysia) setErrors({ ...errors, cityInMalaysia: undefined });
            }}
            placeholder="e.g. Kuala Lumpur"
          />
          {errors.cityInMalaysia && (
            <p className="text-xs text-red-500 mt-1">{errors.cityInMalaysia}</p>
          )}
        </Field>

        <Field label="Postal Code" required>
          <input
            type="text"
            className={inputClass("postalCode")}
            value={data.postalCode}
            onChange={(e) => {
              onChange({ postalCode: e.target.value });
              if (errors.postalCode) setErrors({ ...errors, postalCode: undefined });
            }}
            placeholder="50088"
            inputMode="numeric"
            maxLength={5}
          />
          {errors.postalCode && (
            <p className="text-xs text-red-500 mt-1">{errors.postalCode}</p>
          )}
        </Field>
      </div>

      {/* State */}
      <Field label="State" required>
        <select
          className={selectClass("stateInMalaysia")}
          value={data.stateInMalaysia}
          onChange={(e) => {
            onChange({ stateInMalaysia: e.target.value });
            if (errors.stateInMalaysia) setErrors({ ...errors, stateInMalaysia: undefined });
          }}
        >
          <option value="">Select state...</option>
          {MALAYSIAN_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {errors.stateInMalaysia && (
          <p className="text-xs text-red-500 mt-1">{errors.stateInMalaysia}</p>
        )}
      </Field>

      {/* Navigation */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex-1 bg-white border-2 border-gray-200 text-gray-700 font-semibold text-base py-4 rounded-2xl transition-all active:scale-95"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          className="flex-1 bg-[#CC0001] hover:bg-red-700 text-white font-semibold text-base py-4 rounded-2xl transition-all active:scale-95"
        >
          Review
        </button>
      </div>
    </div>
  );
}
