// Indonesia All-Indonesia arrival-card recon. Attaches to an already-running
// Chrome on CDP 9222, finds the arrival-card tab, and dumps form structure +
// network activity to /tmp/claude/indonesia-recon/<step>.json.
//
// Usage: node scripts/recon-indonesia.js [step]
//   step defaults to "personal-information" (matches URL slug).

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";
const STEP = process.argv[2] || "personal-information";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const page = pages.find((p) => p.url().includes("allindonesia.imigrasi.go.id"));
  if (!page) {
    console.error("No allindonesia tab found. Open it in Chrome first.");
    console.error("Tabs:", pages.map((p) => p.url()));
    process.exit(2);
  }
  console.log("Attached to:", page.url());

  // Capture network from now on.
  const reqs = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("http")) return;
    if (/\.(png|jpg|jpeg|svg|gif|woff2?|css|ico)(\?|$)/i.test(u)) return;
    reqs.push({
      ts: Date.now(),
      method: r.method(),
      url: u,
      resourceType: r.resourceType(),
      headers: r.headers(),
      postData: r.postData() || null,
    });
  });
  page.on("response", async (resp) => {
    const u = resp.url();
    if (!u.startsWith("http")) return;
    if (!/api|graphql|json/i.test(u) && resp.request().resourceType() !== "xhr" && resp.request().resourceType() !== "fetch") return;
    const m = reqs.find((q) => q.url === u && !q.status);
    if (!m) return;
    m.status = resp.status();
    try {
      const ct = (resp.headers()["content-type"] || "").toLowerCase();
      if (ct.includes("json")) m.responseJson = await resp.json().catch(() => null);
      else if (ct.includes("text")) m.responseText = (await resp.text().catch(() => "")).slice(0, 4000);
    } catch (_) {}
  });

  // Give SPA a moment to settle, then snapshot.
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(1500);

  const snapshot = await page.evaluate(() => {
    const labelFor = (el) => {
      if (el.labels && el.labels.length) return [...el.labels].map((l) => l.innerText.trim()).join(" | ");
      const id = el.id;
      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab) return lab.innerText.trim();
      }
      // Walk ancestors looking for a sibling label.
      let n = el.parentElement;
      for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
        const lab = n.querySelector("label, .label, [class*='Label']");
        if (lab && lab.innerText.trim()) return lab.innerText.trim();
      }
      return null;
    };
    const describe = (el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      name: el.name || null,
      id: el.id || null,
      placeholder: el.placeholder || null,
      required: el.required || el.getAttribute("aria-required") === "true",
      readonly: el.readOnly || el.hasAttribute("readonly"),
      disabled: el.disabled,
      maxLength: el.maxLength > 0 ? el.maxLength : null,
      pattern: el.pattern || null,
      autocomplete: el.autocomplete || null,
      ariaLabel: el.getAttribute("aria-label"),
      label: labelFor(el),
      value: el.value ? String(el.value).slice(0, 80) : null,
      options:
        el.tagName === "SELECT"
          ? [...el.options].slice(0, 50).map((o) => ({ value: o.value, text: o.text }))
          : null,
      classes: el.className && typeof el.className === "string" ? el.className.slice(0, 200) : null,
    });
    const inputs = [...document.querySelectorAll("input,select,textarea")].map(describe);
    const buttons = [...document.querySelectorAll("button, [role='button'], input[type=submit]")].map((b) => ({
      tag: b.tagName.toLowerCase(),
      type: b.type || null,
      text: (b.innerText || b.value || "").trim().slice(0, 80),
      id: b.id || null,
      classes: typeof b.className === "string" ? b.className.slice(0, 200) : null,
      disabled: b.disabled,
    }));
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,legend")].map((h) => ({
      tag: h.tagName.toLowerCase(),
      text: h.innerText.trim().slice(0, 200),
    }));
    const stepIndicator = [...document.querySelectorAll("[class*='step' i], [class*='Step' i], nav ol, nav ul")]
      .slice(0, 5)
      .map((s) => s.innerText.trim().slice(0, 400));
    return {
      url: location.href,
      title: document.title,
      headings,
      stepIndicator,
      inputs,
      buttons,
      htmlSize: document.documentElement.outerHTML.length,
    };
  });

  fs.writeFileSync(path.join(OUT, `${STEP}.snapshot.json`), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(OUT, `${STEP}.html`), await page.content());
  await page.screenshot({ path: path.join(OUT, `${STEP}.png`), fullPage: true });

  // Wait a little extra to capture any async XHRs (country lists etc.)
  await page.waitForTimeout(2000);
  fs.writeFileSync(path.join(OUT, `${STEP}.network.json`), JSON.stringify(reqs, null, 2));

  console.log(JSON.stringify({
    url: snapshot.url,
    title: snapshot.title,
    headingsCount: snapshot.headings.length,
    inputCount: snapshot.inputs.length,
    buttonCount: snapshot.buttons.length,
    networkCount: reqs.length,
    out: OUT,
  }, null, 2));

  // Don't close — leave Chrome alive for the user.
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
