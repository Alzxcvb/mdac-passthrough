// Open the nationality bottom-sheet picker (react-virtuoso) and scroll-collect
// every country label. The scroller is [data-virtuoso-scroller="true"]; each
// item is [data-index] containing a <p> with the country name.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("personal-information"));
  if (!page) { console.error("not on personal-information"); process.exit(2); }
  await page.bringToFront();

  // Reset modal state.
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }

  // Open the nationality dropdown via coords.
  const nat = page.locator('input[id^="spi_nationality_"]').first();
  const box = await nat.boundingBox();
  if (!box) { console.error("nationality input not visible"); process.exit(3); }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 });

  const collected = new Map(); // index -> name
  const collectVisible = async () => {
    const items = await page.evaluate(() => {
      const scroller = document.querySelector('[data-virtuoso-scroller="true"]');
      if (!scroller) return null;
      const rows = [...scroller.querySelectorAll('[data-index]')];
      const out = rows.map((r) => ({
        index: parseInt(r.getAttribute("data-index"), 10),
        text: (r.innerText || "").trim(),
      })).filter((r) => Number.isFinite(r.index));
      return {
        rows: out,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      };
    });
    if (!items) return null;
    for (const r of items.rows) collected.set(r.index, r.text);
    return items;
  };

  let snap = await collectVisible();
  console.log("initial:", { rows: collected.size, scrollHeight: snap.scrollHeight });

  // Scroll until scrollTop stops advancing.
  let lastTop = -1;
  for (let step = 0; step < 400; step++) {
    const advanced = await page.evaluate(() => {
      const s = document.querySelector('[data-virtuoso-scroller="true"]');
      if (!s) return null;
      const before = s.scrollTop;
      s.scrollTop = before + s.clientHeight * 0.7;
      return { before, after: s.scrollTop, scrollHeight: s.scrollHeight, clientHeight: s.clientHeight };
    });
    await page.waitForTimeout(120);
    snap = await collectVisible();
    if (!snap) break;
    const atBottom = snap.scrollTop + snap.clientHeight >= snap.scrollHeight - 4;
    if (atBottom || snap.scrollTop === lastTop) {
      // one extra grab to catch final batch
      await page.waitForTimeout(150);
      await collectVisible();
      break;
    }
    lastTop = snap.scrollTop;
  }

  // Write list.
  const sorted = [...collected.entries()].sort((a, b) => a[0] - b[0]).map(([_, t]) => t);
  fs.writeFileSync(path.join(OUT, "countries.txt"), sorted.join("\n"));
  fs.writeFileSync(path.join(OUT, "countries.json"), JSON.stringify(sorted, null, 2));
  console.log(JSON.stringify({
    count: sorted.length,
    head: sorted.slice(0, 6),
    tail: sorted.slice(-6),
    indonesiaIndex: sorted.indexOf("INDONESIA"),
    usaIndex: sorted.findIndex((n) => /UNITED STATES/.test(n)),
  }, null, 2));

  // Close popup.
  await page.keyboard.press("Escape").catch(() => {});
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
