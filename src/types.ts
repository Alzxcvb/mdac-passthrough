export interface MdacFormData {
  // Personal
  fullName: string;
  passportNumber: string;
  nationality: string;
  dateOfBirth: string;       // YYYY-MM-DD
  sex: string;               // 'Male' | 'Female'
  passportIssueDate: string; // YYYY-MM-DD
  passportExpiry: string;    // YYYY-MM-DD
  email: string;
  phoneCountryCode: string;
  phoneNumber: string;
  homeAddress: string;
  // Travel
  arrivalDate: string;       // YYYY-MM-DD
  flightNumber: string;
  portOfEntry: string;
  departureCity: string;
  durationOfStay: number;
  hotelName: string;
  addressInMalaysia: string;
  cityInMalaysia: string;
  postalCode: string;
  accommodationPhone: string;
}

export interface SubmitResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface RetrieveResult {
  success: boolean;
  qrImageBase64?: string;
  pdfBase64?: string;
  error?: string;
}
