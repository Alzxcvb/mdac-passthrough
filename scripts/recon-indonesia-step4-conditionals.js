// Walk every conditional on step 4 (Declaration). For each Yes/No chip pair,
// click Yes, snapshot the new fields + capture any XHRs, then click No to
// collapse. Log everything new the page renders. DO NOT click final Submit.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("/declaration/"));
  if (!page) { console.error("not on declaration step"); process.exit(2); }
  await page.bringToFront();
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }

  const reqs = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("http")) return;
    if (/\.(png|jpg|jpeg|svg|gif|woff2?|css|ico|js|map)(\?|$)/i.test(u)) return;
    reqs.push({ ts: Date.now(), method: r.method(), url: u, postData: r.postData() || null });
  });
  page.on("response", async (resp) => {
    const m = reqs.find((q) => q.url === resp.url() && !q.status);
    if (!m) return;
    m.status = resp.status();
    try { if ((resp.headers()["content-type"] || "").includes("json")) m.responseJson = await resp.json().catch(() => null); } catch (_) {}
  });

  const fullSnapshot = async (tag) => {
    const data = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input, textarea")].map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        type: el.type || null,
        placeholder: el.placeholder || null,
        readonly: el.hasAttribute("readonly"),
        disabled: el.disabled,
        value: el.value ? String(el.value).slice(0, 80) : null,
      }));
      const visibleHeadings = [...document.querySelectorAll("h1, h2, h3, h4, h5, p")]
        .map((h) => (h.textContent || "").trim())
        .filter((t) => t.length > 0 && t.length < 250);
      const buttons = [...document.querySelectorAll("button, [role='button']")]
        .map((b) => (b.textContent || "").trim()).filter((t) => t && t.length < 80);
      return { inputs, visibleHeadings, buttons };
    });
    fs.writeFileSync(path.join(OUT, `step4-cond-${tag}.json`), JSON.stringify(data, null, 2));
    return data;
  };

  // Find Yes/No chips by section heading text and click.
  const clickChipInSection = async (sectionMatch, value) => {
    return await page.evaluate(([match, v]) => {
      const all = [...document.querySelectorAll("h1, h2, h3, h4, h5, p")];
      const head = all.find((n) => (n.textContent || "").includes(match));
      if (!head) return { ok: false, reason: `no section "${match}"` };
      // Walk up to find the section container (a div that contains both the heading and Yes/No inputs).
      let scope = head;
      let target = null;
      for (let i = 0; i < 10 && scope; i++, scope = scope.parentElement) {
        const inputs = [...scope.querySelectorAll("input")];
        const inp = inputs.find((x) => x.value === v && x.readOnly);
        if (inp) {
          target = inp;
          break;
        }
      }
      if (!target) return { ok: false, reason: `no chip "${v}" near "${match}"` };
      let n = target.parentElement;
      let click = target;
      for (let j = 0; j < 6 && n; j++, n = n.parentElement) {
        if (getComputedStyle(n).cursor === "pointer") { click = n; break; }
      }
      const r = click.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
      click.dispatchEvent(new MouseEvent("mousedown", opts));
      click.dispatchEvent(new MouseEvent("mouseup", opts));
      click.dispatchEvent(new MouseEvent("click", opts));
      return { ok: true, tag: click.tagName };
    }, [sectionMatch, value]);
  };

  const baseline = await fullSnapshot("baseline");
  console.log("baseline inputs:", baseline.inputs.length);
  const baseIds = new Set(baseline.inputs.map((i) => i.id || "(no-id)#" + (i.value || i.placeholder || "")));
  const baseHeadings = new Set(baseline.visibleHeadings);

  const toggles = [
    { section: "Do you currently have any of the following symptoms", on: "Yes", off: "No" },
    { section: "Are you bringing any animals", on: "Yes", off: "No" },
    { section: "Do you carry goods that must be declared", on: "Yes", off: "No" },
    { section: "Are you bringing Mobile Phones", on: "Yes", off: "No" },
  ];

  const findings = {};
  for (const t of toggles) {
    console.log("\n===", t.section);
    const reqsBefore = reqs.length;
    const yes = await clickChipInSection(t.section, t.on);
    console.log("  click Yes:", yes);
    await page.waitForTimeout(1500);
    const onSnap = await fullSnapshot(`yes-${t.section.slice(0, 16).replace(/\W+/g, "-")}`);
    const newInputs = onSnap.inputs.filter((i) => !baseIds.has(i.id || "(no-id)#" + (i.value || i.placeholder || "")));
    const newHeadings = onSnap.visibleHeadings.filter((h) => !baseHeadings.has(h));
    const newReqs = reqs.slice(reqsBefore);
    findings[t.section] = {
      newInputs: newInputs.map((i) => ({ id: i.id, placeholder: i.placeholder, value: i.value, readonly: i.readonly })),
      newHeadings: newHeadings.slice(0, 8),
      xhrs: newReqs.filter((r) => r.url.includes("/api/")).map((r) => `${r.method} ${r.url} ${r.status || "(?)"}`),
    };
    console.log("  new inputs:", newInputs.length, "→", newInputs.map((i) => i.id || "(no-id)").slice(0, 8).join(", "));
    console.log("  new headings:", newHeadings.length, "→", newHeadings.slice(0, 4));
    console.log("  XHRs:", findings[t.section].xhrs);

    // Click No to collapse.
    const no = await clickChipInSection(t.section, t.off);
    await page.waitForTimeout(700);
  }

  // Also look for the captcha input + agreement checkbox.
  console.log("\n=== captcha + agreement checkbox ===");
  const extras = await page.evaluate(() => {
    // Captcha input is likely an input with placeholder "captcha" or near a captcha image.
    const allInputs = [...document.querySelectorAll("input")];
    const captchaInput = allInputs.find((i) => /captcha|verification|enter the|kode/i.test(i.placeholder || "")) || null;
    // Agreement checkbox — find by surrounding text "hereby certify".
    const certifyText = "hereby certify";
    const all = [...document.querySelectorAll("p, div, label, span")];
    const certifyNode = all.find((n) => (n.textContent || "").includes(certifyText));
    let agreementWrap = null;
    let agreementInput = null;
    if (certifyNode) {
      let scope = certifyNode;
      for (let i = 0; i < 6 && scope; i++, scope = scope.parentElement) {
        const inp = scope.querySelector("input[type='checkbox'], input[readonly], div[role='checkbox']");
        if (inp) { agreementWrap = scope; agreementInput = inp; break; }
      }
    }
    // Look for any image element near "captcha".
    const imgs = [...document.querySelectorAll("img")].map((img) => ({ src: img.src, alt: img.alt })).filter((x) => /captcha|kode|verif/i.test(x.src + " " + (x.alt || "")));
    // Look for elements whose innerText contains a 4-digit number in a context that looks like a captcha display.
    return {
      captchaInput: captchaInput ? { id: captchaInput.id, placeholder: captchaInput.placeholder, type: captchaInput.type } : null,
      certifyNode: certifyNode ? { tag: certifyNode.tagName, text: (certifyNode.textContent || "").slice(0, 200) } : null,
      agreementInput: agreementInput ? { tag: agreementInput.tagName, type: agreementInput.type, role: agreementInput.getAttribute("role") } : null,
      agreementWrapTag: agreementWrap ? agreementWrap.tagName : null,
      captchaImages: imgs,
    };
  });
  console.log("  captcha input:", extras.captchaInput);
  console.log("  agreement input:", extras.agreementInput);
  console.log("  certify text node:", extras.certifyNode);
  findings._extras = extras;

  fs.writeFileSync(path.join(OUT, "step4-conditionals.json"), JSON.stringify(findings, null, 2));
  fs.writeFileSync(path.join(OUT, "step4-conditional-net.json"), JSON.stringify(reqs, null, 2));

  // Take a final screenshot.
  await page.screenshot({ path: path.join(OUT, "step4-conditional-final.png"), fullPage: true });
  console.log("\nartifacts:", OUT);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
