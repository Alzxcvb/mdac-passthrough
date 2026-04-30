import { FormData, PROFILE_FIELDS, EMPTY_FORM } from "./types";

const STORAGE_KEY = "mdac_profile";
const FORM_KEY = "mdac_form_draft";
const STEP_KEY = "mdac_form_step";

export function saveProfile(data: FormData): void {
  if (typeof window === "undefined") return;
  const profile: Partial<FormData> = {};
  PROFILE_FIELDS.forEach((field) => {
    (profile as Record<string, unknown>)[field] = data[field];
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function loadProfile(): Partial<FormData> | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<FormData>;
  } catch {
    return null;
  }
}

export function hasProfile(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem(STORAGE_KEY);
}

export function clearProfile(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function saveDraft(data: FormData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(FORM_KEY, JSON.stringify(data));
}

export function loadDraft(): FormData | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(FORM_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FormData;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(FORM_KEY);
  localStorage.removeItem(STEP_KEY);
}

export function saveStep(step: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STEP_KEY, String(step));
}

export function loadStep(): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STEP_KEY);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 4 ? n : null;
}

export function mergeProfileIntoForm(
  base: FormData,
  profile: Partial<FormData>
): FormData {
  const merged = { ...base };
  PROFILE_FIELDS.forEach((field) => {
    if (profile[field] !== undefined && profile[field] !== "") {
      (merged as Record<string, unknown>)[field] = profile[field];
    }
  });
  return merged;
}

export function resetTripFields(data: FormData): FormData {
  return {
    ...data,
    arrivalDate: "",
    departureDate: "",
    saveProfile: true,
  };
}

export function buildNewFormFromProfile(): FormData {
  const profile = loadProfile();
  if (!profile) return { ...EMPTY_FORM };
  return mergeProfileIntoForm({ ...EMPTY_FORM }, profile);
}
