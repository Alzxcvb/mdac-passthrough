// Click the readonly Passport/Country/Region input on the Foreign Visitor
// personal-info form so the SPA fires whatever XHR populates the country
// list. Capture network requests + the rendered option list. Same Chrome.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) =>
    p.url().includes("allindonesia.imigrasi.go.id") && p.url().includes("personal-information")
  );
  if (!page) {
    console.error("personal-information tab not found");
    console.error("Tabs:", ctx.pages().map((p) => p.url()));
    process.exit(2);
  }
  await page.bringToFront();

  const reqs = [];
  const onReq = (r) => {
    const u = r.url();
    if (!u.startsWith("http")) return;
    if (/\.(png|jpg|jpeg|svg|gif|woff2?|css|ico)(\?|$)/i.test(u)) return;
    reqs.push({ ts: Date.now(), method: r.method(), url: u, type: r.resourceType(), postData: r.postData() || null });
  };
  const onResp = async (resp) => {
    const u = resp.url();
    const m = reqs.find((q) => q.url === u && !q.status);
    if (!m) return;
    m.status = resp.status();
    try {
      const ct = (resp.headers()["content-type"] || "").toLowerCase();
      if (ct.includes("json")) m.responseJson = await resp.json().catch(() => null);
      else if (ct.includes("text")) m.responseText = (await resp.text().catch(() => "")).slice(0, 6000);
    } catch (_) {}
  };
  page.on("request", onReq);
  page.on("response", onResp);

  // Click the nationality field. It's a readonly input with id starting spi_nationality_.
  const nat = page.locator('input[id^="spi_nationality_"]').first();
  await nat.click();
  await page.waitForTimeout(1500);

  // Try to capture whatever popup/menu rendered. Look for elements that
  // appeared after the click.
  const opened = await page.evaluate(() => {
    // Heuristic: find a node containing many country-name-looking children.
    const all = [...document.querySelectorAll("ul, ol, div")];
    const candidates = all
      .map((el) => {
        const items = [...el.querySelectorAll("li, button, [role='option'], div")]
          .map((c) => c.innerText && c.innerText.trim())
          .filter(Boolean);
        const looksLikeCountries = items.filter((t) => /^[A-Z][A-Za-z .'\-()]{2,40}$/.test(t)).length;
        return { el, count: items.length, looksLike: looksLikeCountries, sample: items.slice(0, 6) };
      })
      .filter((c) => c.looksLike > 20)
      .sort((a, b) => b.looksLike - a.looksLike)
      .slice(0, 3);
    return candidates.map((c) => ({
      tag: c.el.tagName.toLowerCase(),
      classes: typeof c.el.className === "string" ? c.el.className.slice(0, 200) : null,
      itemCount: c.count,
      countryLike: c.looksLike,
      sample: c.sample,
    }));
  });
  fs.writeFileSync(path.join(OUT, "nationality-popup.json"), JSON.stringify(opened, null, 2));

  // Try to extract the full list of options from whichever popup looks most like a country picker.
  const allOptions = await page.evaluate(() => {
    const findPopup = () => {
      const all = [...document.querySelectorAll("ul, ol, div")];
      let best = null;
      let bestScore = 0;
      for (const el of all) {
        const items = [...el.querySelectorAll("li, button, [role='option']")]
          .map((c) => (c.innerText || "").trim())
          .filter(Boolean);
        const score = items.filter((t) => /^[A-Z][A-Za-z .'\-()]{2,40}$/.test(t)).length;
        if (score > bestScore) { bestScore = score; best = el; }
      }
      return best;
    };
    const popup = findPopup();
    if (!popup) return null;
    const items = [...popup.querySelectorAll("li, button, [role='option']")].map((c) => ({
      text: (c.innerText || "").trim(),
      dataset: { ...c.dataset },
      value: c.value || c.getAttribute("data-value") || null,
    }));
    return { tag: popup.tagName.toLowerCase(), classes: popup.className, items };
  });
  if (allOptions) {
    fs.writeFileSync(path.join(OUT, "nationality-options.json"), JSON.stringify(allOptions, null, 2));
  }

  await page.screenshot({ path: path.join(OUT, "nationality-popup.png"), fullPage: true });

  // Wait a touch more for any lazy XHRs.
  await page.waitForTimeout(1500);
  fs.writeFileSync(path.join(OUT, "nationality.network.json"), JSON.stringify(reqs, null, 2));

  console.log(JSON.stringify({
    tabUrl: page.url(),
    reqCount: reqs.length,
    apiCalls: reqs.filter((r) => /api|graphql|json/i.test(r.url)).map((r) => `${r.method} ${r.url}`),
    optionsItemCount: allOptions ? allOptions.items.length : null,
    sampleOptions: allOptions ? allOptions.items.slice(0, 5) : null,
  }, null, 2));

  // Close the popup so the user's screen doesn't stay weird. ESC.
  await page.keyboard.press("Escape").catch(() => {});
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
