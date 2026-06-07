"use client";

import { type FormData, PHONE_COUNTRY_CODES } from "@/lib/types";
import { ID_PURPOSE_OPTIONS, ID_AIRPORTS } from "@/lib/id-codes";

interface Props {
  data: FormData;
  onChange: (updates: Partial<FormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const inputClass =
  "w-full rounded-xl border-2 px-4 py-3 text-base border-gray-200 focus:border-[#003893] focus:outline-none";

export default function IndonesiaTravelStep({ data, onChange, onNext, onBack }: Props) {
  const canContinue =
    Boolean(data.passportExpiry) &&
    Boolean(data.email) &&
    Boolean(data.phoneNumber) &&
    Boolean(data.arrivalDate) &&
    Boolean(data.arrivalAirport);

  return (
    <div className="step-enter space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Travel &amp; Contact</h2>
        <p className="text-sm text-gray-500 mt-1">Your Indonesia arrival details</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Passport Expiry</label>
          <input
            type="date"
            value={data.passportExpiry}
            onChange={(e) => onChange({ passportExpiry: e.target.value })}
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
          <input
            type="email"
            value={data.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="you@example.com"
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mobile</label>
          <div className="flex gap-2">
            <select
              value={data.phoneCountryCode}
              onChange={(e) => onChange({ phoneCountryCode: e.target.value })}
              className="rounded-xl border-2 px-3 py-3 text-base border-gray-200 focus:border-[#003893] focus:outline-none w-28"
            >
              {PHONE_COUNTRY_CODES.map((c) => (
                <option key={`${c.code}-${c.country}`} value={c.code}>
                  {c.code} {c.country}
                </option>
              ))}
            </select>
            <input
              type="tel"
              value={data.phoneNumber}
              onChange={(e) => onChange({ phoneNumber: e.target.value.replace(/\D/g, "") })}
              placeholder="Phone number"
              className={`${inputClass} flex-1`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Arrival Date</label>
            <input
              type="date"
              value={data.arrivalDate}
              onChange={(e) => onChange({ arrivalDate: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Departure Date</label>
            <input
              type="date"
              value={data.departureDate}
              onChange={(e) => onChange({ departureDate: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Arrival Airport</label>
          <input
            list="id-airports"
            value={data.arrivalAirport}
            onChange={(e) => onChange({ arrivalAirport: e.target.value.toUpperCase().slice(0, 3) })}
            placeholder="e.g. CGK, DPS"
            className={inputClass}
          />
          <datalist id="id-airports">
            {ID_AIRPORTS.map((a) => (
              <option key={a.iata} value={a.iata}>
                {a.name}
              </option>
            ))}
          </datalist>
          <p className="text-xs text-gray-400 mt-1">3-letter IATA code of where you land in Indonesia.</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Flight Number</label>
          <input
            type="text"
            value={data.flightNumber}
            onChange={(e) => onChange({ flightNumber: e.target.value.toUpperCase() })}
            placeholder="e.g. GA880"
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Purpose of Travel</label>
          <select
            value={data.purposeOfTravel}
            onChange={(e) => onChange({ purposeOfTravel: e.target.value })}
            className={inputClass}
          >
            <option value="">Select a purpose</option>
            {ID_PURPOSE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Accommodation</label>
          <select
            value={data.accommodationType}
            onChange={(e) =>
              onChange({ accommodationType: e.target.value as FormData["accommodationType"] })
            }
            className={inputClass}
          >
            <option value="">Select type</option>
            <option value="Hotel">Hotel</option>
            <option value="Residential">Residential</option>
            <option value="Others">Others</option>
          </select>
        </div>

        {data.accommodationType === "Hotel" && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Hotel Name</label>
            <input
              type="text"
              value={data.hotelName}
              onChange={(e) => onChange({ hotelName: e.target.value })}
              placeholder="Search by hotel name"
              className={inputClass}
            />
          </div>
        )}

        {(data.accommodationType === "Residential" || data.accommodationType === "Others") && (
          <>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Address in Indonesia</label>
              <input
                type="text"
                value={data.addressInIndonesia}
                onChange={(e) => onChange({ addressInIndonesia: e.target.value })}
                placeholder="Street address"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Province</label>
                <input
                  type="text"
                  value={data.indonesiaProvince}
                  onChange={(e) => onChange({ indonesiaProvince: e.target.value })}
                  placeholder="e.g. BALI"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">City</label>
                <input
                  type="text"
                  value={data.indonesiaCity}
                  onChange={(e) => onChange({ indonesiaCity: e.target.value })}
                  placeholder="City"
                  className={inputClass}
                />
              </div>
            </div>
          </>
        )}

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            Visa / Stay-Permit Number <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={data.visaPermitNumber}
            onChange={(e) => onChange({ visaPermitNumber: e.target.value })}
            placeholder="If applicable"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 bg-white border-2 border-gray-200 text-gray-700 font-semibold text-base py-4 rounded-2xl transition-all active:scale-95"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="flex-1 bg-[#003893] hover:bg-blue-900 text-white font-semibold text-base py-4 rounded-2xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
