# mdac-passthrough

A lightweight Express + Playwright backend that submits traveler data to the official Malaysian Digital Arrival Card (MDAC) system on behalf of users, and retrieves the official QR code using their PIN.

## What it does

1. Receives form data from the mdac-better frontend
2. Uses Playwright (headless Chromium) to fill and submit the official MDAC form at `https://imigresen-online.imi.gov.my/mdac/main`
3. After submission, the traveler receives a PIN by email
4. The frontend calls `/api/retrieve-qr` with the PIN to fetch the official QR code / confirmation PDF

## Deploy to Railway

1. Push this repo to GitHub
2. Create a new Railway project and connect the repo
3. Railway will detect the `railway.toml` and build with Nixpacks
4. The `startCommand` installs Playwright's Chromium browser at startup, then runs the server

## Environment Variables

| Variable         | Required | Description                                               |
|------------------|----------|-----------------------------------------------------------|
| `PORT`           | No       | Port to listen on (default: 3001, Railway sets this auto) |
| `ALLOWED_ORIGIN` | No       | CORS origin to allow (e.g. `https://mdac-better.vercel.app`). If unset, all origins are allowed. |

## API Endpoints

### `GET /health`

Health check.

**Response:**
```json
{ "status": "ok", "timestamp": "2024-01-01T00:00:00.000Z" }
```

---

### `POST /api/submit`

Submit traveler data to the official MDAC system.

**Request body:**
```json
{
  "fullName": "John Smith",
  "passportNumber": "A1234567",
  "nationality": "American",
  "dateOfBirth": "1990-05-15",
  "sex": "Male",
  "passportIssueDate": "2020-01-01",
  "passportExpiry": "2030-01-01",
  "email": "john@example.com",
  "phoneCountryCode": "+1",
  "phoneNumber": "5551234567",
  "homeAddress": "123 Main St, New York, NY 10001",
  "arrivalDate": "2024-03-15",
  "flightNumber": "MH370",
  "portOfEntry": "KLIA (Kuala Lumpur International Airport)",
  "departureCity": "New York",
  "durationOfStay": 7,
  "hotelName": "Mandarin Oriental",
  "addressInMalaysia": "Kuala Lumpur City Centre",
  "cityInMalaysia": "Kuala Lumpur",
  "postalCode": "50088",
  "accommodationPhone": "+60312345678"
}
```

**Success response (200):**
```json
{
  "success": true,
  "message": "Submission complete. Check your email for your PIN code."
}
```

**Error response (422):**
```json
{
  "success": false,
  "error": "Form submission error: ..."
}
```

---

### `POST /api/retrieve-qr`

Retrieve the official QR code after receiving a PIN by email.

**Request body:**
```json
{
  "phoneCountryCode": "+1",
  "phoneNumber": "5551234567",
  "pin": "123456"
}
```

**Success response (200) — QR image:**
```json
{
  "success": true,
  "qrImageBase64": "<base64-encoded PNG>"
}
```

**Success response (200) — PDF:**
```json
{
  "success": true,
  "pdfBase64": "<base64-encoded PDF>"
}
```

**Error response (422):**
```json
{
  "success": false,
  "error": "Retrieval error — check phone number and PIN"
}
```

## Important Notes on Selectors

The Playwright automation targets the MDAC site's form fields using CSS selectors based on `name`, `id`, and text content. These **will drift** as the Malaysian immigration site updates. If the automation starts failing:

1. Set `headless: false` in `src/services/mdac.ts` locally to watch what Playwright does
2. Inspect the live form fields in DevTools to find the correct `name`/`id`/`class` values
3. Update the selectors in `src/services/mdac.ts` and redeploy

Look for `// SELECTOR NOTE:` and `// TODO:` comments throughout `src/services/mdac.ts` — these mark the most likely points of failure.
