"use client";

import { FormData } from "@/lib/types";

interface Props {
  data: FormData;
  onChange: (updates: Partial<FormData>) => void;
  onSubmit: () => void;
  onBack: () => void;
}

interface ReviewRowProps {
  label: string;
  value: string;
}

function ReviewRow({ label, value }: ReviewRowProps) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 font-medium w-2/5 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-900 font-medium text-right flex-1 ml-2 break-all">
        {value || "—"}
      </span>
    </div>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const [year, month, day] = dateStr.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[parseInt(month) - 1]} ${year}`;
}

export default function ReviewStep({ data, onChange, onSubmit, onBack }: Props) {
  return (
    <div className="step-enter space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Review Your Information</h2>
        <p className="text-sm text-gray-500 mt-1">Please check everything before generating your card</p>
      </div>

      {/* Personal Info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-[#003893] px-4 py-2.5">
          <h3 className="text-xs font-bold text-white uppercase tracking-wide">Personal Information</h3>
        </div>
        <div className="px-4 pb-1 pt-1">
          <ReviewRow label="Full Name" value={data.fullName} />
          <ReviewRow label="Passport No." value={data.passportNumber} />
          <ReviewRow label="Passport Type" value={data.passportType} />
          <ReviewRow label="Nationality" value={data.nationality} />
          <ReviewRow label="Date of Birth" value={formatDate(data.dateOfBirth)} />
          <ReviewRow label="Sex" value={data.sex} />
          <ReviewRow label="Country of Issuance" value={data.countryOfPassportIssuance} />
          <ReviewRow label="Place of Birth" value={data.placeOfBirth} />
        </div>
      </div>

      {/* Travel Info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-[#CC0001] px-4 py-2.5">
          <h3 className="text-xs font-bold text-white uppercase tracking-wide">Travel Information</h3>
        </div>
        <div className="px-4 pb-1 pt-1">
          <ReviewRow label="Passport Expiry" value={formatDate(data.passportExpiry)} />
          <ReviewRow label="Email" value={data.email} />
          <ReviewRow label="Phone" value={`${data.phoneCountryCode} ${data.phoneNumber}`} />
          <ReviewRow label="Arrival" value={formatDate(data.arrivalDate)} />
          <ReviewRow label="Departure" value={formatDate(data.departureDate)} />
          <ReviewRow label="Transport" value={`${data.modeOfTransport} — ${data.flightNumber}`} />
          <ReviewRow label="Departed From" value={data.departureCountry} />
          <ReviewRow label="Hotel" value={data.hotelName} />
          <ReviewRow label="Address in MY" value={data.addressInMalaysia} />
          <ReviewRow label="City / State" value={`${data.cityInMalaysia}, ${data.stateInMalaysia}`} />
          <ReviewRow label="Postal Code" value={data.postalCode} />
        </div>
      </div>

      {/* Save profile toggle */}
      <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <div className="relative flex-shrink-0">
            <input
              type="checkbox"
              className="sr-only"
              checked={data.saveProfile}
              onChange={(e) => onChange({ saveProfile: e.target.checked })}
            />
            <div
              onClick={() => onChange({ saveProfile: !data.saveProfile })}
              className={`w-12 h-6 rounded-full transition-colors cursor-pointer ${
                data.saveProfile ? "bg-[#003893]" : "bg-gray-300"
              }`}
            >
              <div
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  data.saveProfile ? "translate-x-6" : "translate-x-0.5"
                }`}
              />
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Save profile for next trip</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Saved to <strong>this device only</strong> — no account, no server. Next trip takes 10 seconds.
            </p>
          </div>
        </label>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex-1 bg-white border-2 border-gray-200 text-gray-700 font-semibold text-base py-4 rounded-2xl transition-all active:scale-95"
        >
          Back
        </button>
        <button
          onClick={onSubmit}
          className="flex-1 bg-[#003893] hover:bg-blue-900 text-white font-semibold text-base py-4 rounded-2xl transition-all active:scale-95"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
