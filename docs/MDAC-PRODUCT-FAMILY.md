# The MDAC Product Family: How the Three Pieces Fit

All three projects exist to fix the same thing: Malaysia's official Digital Arrival Card form is slow, ugly, and breaks on phones. You built three different attempts at "make it better." This doc explains what each one actually is, where each hits a wall, and whether one setup could ever cover everything.

Last updated: 2026-06-06.

---

## The one shared idea

Strip the three projects down and they all contain the same engine:

> **A saved traveler profile + a country adapter that knows how to map that profile onto a specific government form.**

Profile (name, passport, DOB, nationality, dates, accommodation) gets entered once. The adapter handles the messy part: the field names, the date format, the country codes, the slider CAPTCHA. Everything else is just a different shell wrapped around that same engine.

So the projects do not really compete on the engine. They compete on **how the form gets filled and who is allowed to do it.**

---

## The three shells

### 1. MDAC Better (desktop web app + Chrome extension)
- **Surface:** Browser on a laptop. PWA at `mdac-better.vercel.app`, plus a Manifest V3 extension that autofills the real government form in place.
- **Who fills the form:** The user, in their own browser, looking at the real site.
- **CAPTCHA:** The user solves it. You never touch it.
- **Why it stops at desktop:** iOS Safari enforces page CSP against `javascript:` bookmarks, so the mobile autofill path is dead. That single limitation is the reason Arrival Pass exists.
- **Status:** Live. Extension is one upload away from the Chrome Web Store (v0.1.2 zip, permissions trimmed to `storage` after a rejection).

### 2. Arrival Pass (native iOS app)
- **Surface:** A real app on the phone. Expo + React Native, embedded WebView.
- **Who fills the form:** The app injects JavaScript into a WebView that loads the real government site. This sidesteps the Safari CSP wall that killed MDAC Better on mobile.
- **CAPTCHA:** The user solves it. **By design the app never auto-submits and never auto-solves the CAPTCHA.** That is a hard rule, written into the project, because App Store review (guideline 4.2) and foreign-government goodwill both depend on it.
- **Why it is the cleanest long-term play:** Country-adapter registry means adding Thailand or Indonesia is a new module, not a rewrite. Singapore has a native arrival-card app and Malaysia does not, so "native ergonomics for every country" is a real gap.
- **Status:** Built, Apple Developer account active, blocked on the first on-device test.

### 3. MDAC Passthrough (server that files for you)
- **Surface:** A web app that takes your details and does the whole thing for you on a server. Frontend on Vercel, headless Chromium + Playwright backend on Railway.
- **Who fills the form:** The server. The user never sees the real government site at all. They fill a clean 3-step form, the backend drives a headless browser, solves the slider CAPTCHA automatically, submits, and hands back the QR.
- **CAPTCHA:** **The server auto-solves it** (Jimp heuristic now, 2Captcha fallback being added).
- **Why it is powerful and risky:** It is the only one that is genuinely one-tap. It is also the only one that auto-submits to a government system on the user's behalf, which is why it carries a loud gray-zone disclosure and stays a separate product.
- **Status:** Live, never validated against a real submission yet.

---

## The limitations, side by side

| | MDAC Better | Arrival Pass | Passthrough |
|---|---|---|---|
| Works on phone | No (Safari CSP) | Yes | Yes |
| Works on desktop | Yes | No (it is an app) | Yes |
| User sees real gov site | Yes | Yes (in WebView) | No |
| Who solves CAPTCHA | User | User | Server (auto) |
| Auto-submits for user | No | No (banned by design) | Yes |
| App Store / Web Store safe | Yes | Yes | N/A (own web app) |
| Gray-zone exposure | None | None | Yes |
| Multi-country ready | Partial | Yes (adapter registry) | Malaysia + Indonesia in progress |

---

## Can one setup just work everywhere?

Short answer: **one app that does everything for everyone is not reachable. One shared engine behind three thin shells is.**

The thing that cannot be reconciled is auto-submit and auto-CAPTCHA. It is the single feature that splits the family in two:

- Passthrough is useful **because** it auto-files and auto-solves. Remove that and it is just another form.
- Arrival Pass is allowed in the App Store **because** it never auto-files or auto-solves. Add that and Apple rejects it and you pick a fight with a foreign immigration system.

You cannot have a single product that both auto-files (Passthrough's whole value) and stays App-Store-clean (Arrival Pass's whole value). Those are opposite commitments. So "one binary that just works on every device" is a dead end.

What **is** reachable, and is actually the strongest version of this:

> **One shared form-fill engine (profile model + country adapters), packaged into three delivery shells.**

```
                shared engine
   profile model  +  country adapters (MY, ID, TH, ...)
   field maps, date formats, country codes, CAPTCHA hints
        |                  |                   |
   ┌────┴─────┐      ┌─────┴──────┐      ┌─────┴──────┐
   │ Extension │      │ Native app │      │ Passthrough │
   │ + web PWA │      │  (iOS/RN)  │      │  (server)   │
   │  desktop  │      │   mobile   │      │ power path  │
   │ user CAPTCHA│    │user CAPTCHA│      │auto CAPTCHA │
   └───────────┘      └────────────┘      └─────────────┘
```

The user picks the shell that fits their situation, not the device:
- On a laptop, the extension or web app autofills the real form. Clean and safe.
- On a phone, the native app is the daily driver. Clean and safe, store-distributable.
- When someone wants true one-tap and accepts the gray-zone tradeoff, Passthrough does the whole thing server-side.

The win is that the adapters are written once. The Malaysia field map, the Indonesia readonly-gender-div quirk, the date formatter, the ISO3 country table: that work should live in **one** package and be imported by all three shells, instead of being ported by hand between repos (which is what is happening now, the Arrival Pass adapter was hand-ported from the MDAC Better PWA script).

### The concrete next move if you want to unify

Not a rewrite. Extract the adapter layer into a tiny shared package (`@mdac/adapters` or similar) that exports, per country: the field-name map, value mappings, date format, and CAPTCHA hint. Then:
- MDAC Better extension imports it for its content script.
- Arrival Pass imports it for its WebView injection.
- Passthrough imports it for its Playwright fill.

Each shell still owns its own delivery and its own CAPTCHA policy. Only the brittle, drift-prone form knowledge gets centralized. That is the version of "one setup" that is real: not one app, but one brain with three mouths.

---

## Honest status read

- **Most shippable right now:** MDAC Better extension (one Web Store upload away).
- **Best long-term bet:** Arrival Pass (store-distributable, multi-country, clean).
- **Highest ceiling, highest risk:** Passthrough (only true one-tap, but gray-zone and unvalidated).
- **Biggest hidden cost across all three:** the adapter knowledge is duplicated, so every government form change has to be fixed in up to three places. The shared-engine extraction is the cleanup that pays that down.
</content>
</invoke>
