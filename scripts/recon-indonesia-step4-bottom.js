// Inspect the bottom of the step 4 page — find the agreement checkbox + the
// captcha input. Also dump the section-by-section DOM hierarchy so the
// adapter has stable selectors for each chip pair.
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
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);

  const dump = await page.evaluate(() => {
    // List every section, walking the form DOM. Each Yes/No chip pair lives
    // under a section heading. We capture the heading text + the chip
    // wrappers' bounding ids/classes for stable selection.
    const sections = [];
    const allInputs = [...document.querySelectorAll("input")];
    const yesNoInputs = allInputs.filter((i) => /^(Yes|No)$/.test(i.value || ""));

    // Group Yes/No inputs by parent container (the wrapper holding both).
    const groups = new Map();
    for (const inp of yesNoInputs) {
      // Walk up until we find the parent that holds BOTH a Yes and a No input.
      let n = inp.parentElement;
      let group = null;
      for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
        const inputs = [...n.querySelectorAll("input")].filter((x) => /^(Yes|No)$/.test(x.value || ""));
        const values = new Set(inputs.map((x) => x.value));
        if (values.has("Yes") && values.has("No") && inputs.length === 2) {
          group = n;
          break;
        }
      }
      if (!group) continue;
      if (!groups.has(group)) groups.set(group, { yes: null, no: null, group });
      const g = groups.get(group);
      if (inp.value === "Yes") g.yes = inp;
      if (inp.value === "No") g.no = inp;
    }

    // For each group, find the nearest preceding heading/question.
    const findQuestion = (group) => {
      // Look for a <p> or text node BEFORE the group that ends with "?" or is the question text.
      let n = group.previousElementSibling;
      for (let i = 0; i < 6 && n; i++, n = n.previousElementSibling) {
        const t = (n.textContent || "").trim();
        if (t.length > 6 && t.length < 250) return t;
      }
      // Also look up to parent's prev sibling.
      let p = group.parentElement;
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        let s = p.previousElementSibling;
        for (let j = 0; j < 4 && s; j++, s = s.previousElementSibling) {
          const t = (s.textContent || "").trim();
          if (t.length > 6 && t.length < 250) return t;
        }
      }
      return null;
    };

    const result = [];
    let idx = 0;
    for (const [el, g] of groups) {
      const r = el.getBoundingClientRect();
      result.push({
        index: idx++,
        question: findQuestion(el),
        groupId: el.id || null,
        groupClass: el.className && typeof el.className === "string" ? el.className.slice(0, 100) : null,
        groupRect: { top: Math.round(r.top + window.scrollY), left: Math.round(r.left), height: Math.round(r.height) },
        yesId: g.yes && g.yes.id,
        noId: g.no && g.no.id,
      });
    }

    // Find captcha-related elements anywhere on the page.
    // Look for elements containing a 4-digit number in a special font/style.
    const captchaArea = (() => {
      const all = [...document.querySelectorAll("*")];
      // Often captcha is rendered as styled text — look for elements where text matches /^\d{4}$/
      const captchaText = all.find((el) => {
        const t = (el.textContent || "").trim();
        if (!/^\d{4}$/.test(t)) return false;
        if (el.children.length > 0) return false;
        return true;
      });
      if (!captchaText) return null;
      return {
        text: captchaText.textContent,
        tag: captchaText.tagName,
        classes: captchaText.className && typeof captchaText.className === "string" ? captchaText.className.slice(0, 100) : null,
        nearby: (() => {
          let n = captchaText.parentElement;
          for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
            const inp = n.querySelector("input[type='text']");
            if (inp) return { inputId: inp.id, placeholder: inp.placeholder };
          }
          return null;
        })(),
      };
    })();

    // Find the agreement checkbox specifically.
    const agreementText = "I, the Applicant hereby certify";
    const certifyP = [...document.querySelectorAll("p")].find((p) => (p.textContent || "").includes(agreementText));
    let agreementChip = null;
    if (certifyP) {
      // Walk up to row container, look for a sibling div with a checked indicator.
      let n = certifyP.parentElement;
      for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
        // Look for a circle/box-shaped element earlier in the row.
        const box = n.querySelector("div[style*='border-radius']");
        if (box && !n.querySelector("img")) {
          agreementChip = {
            rowTag: n.tagName,
            rowClasses: n.className && typeof n.className === "string" ? n.className.slice(0, 100) : null,
            boxOuter: box.outerHTML.slice(0, 300),
          };
          break;
        }
      }
    }

    return {
      yesNoGroupCount: result.length,
      yesNoGroups: result,
      captcha: captchaArea,
      agreement: agreementChip,
    };
  });

  fs.writeFileSync(path.join(OUT, "step4-bottom-dump.json"), JSON.stringify(dump, null, 2));
  console.log("Yes/No groups found:", dump.yesNoGroupCount);
  for (const g of dump.yesNoGroups) {
    console.log(`  [${g.index}] groupId=${g.groupId || "(none)"} top=${g.groupRect.top}\n    question: ${g.question || "(?)"}`);
  }
  console.log("\ncaptcha display:", dump.captcha);
  console.log("\nagreement chip:", dump.agreement);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
