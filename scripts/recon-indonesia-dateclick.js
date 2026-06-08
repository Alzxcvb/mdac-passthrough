// Open the arrival-date picker, dump a row's HTML, and test clicking it.
const { chromium } = require("playwright");
const ORIGIN = "https://allindonesia.imigrasi.go.id";
const clickPT = (page, label) => page.evaluate((l) => { const all=[...document.querySelectorAll("h1,h2,h3,h4,p,div,span,a,li,button")]; const n=all.find(x=>x.children.length===0&&(x.textContent||"").trim()===l); if(!n)return false; let c=n; for(let i=0;i<10&&c;i++,c=c.parentElement) if(getComputedStyle(c).cursor==="pointer"){c.click();return true;} n.click();return true; }, label);
const openV = (page, sel) => page.evaluate((s)=>{const inp=document.querySelector(s);if(!inp)return false;let n=inp,t=inp;for(let i=0;i<6&&n;i++,n=n.parentElement)if(getComputedStyle(n).cursor==="pointer"){t=n;break;}const r=t.getBoundingClientRect();const o={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,view:window};t.dispatchEvent(new MouseEvent("mousedown",o));t.dispatchEvent(new MouseEvent("mouseup",o));t.dispatchEvent(new MouseEvent("click",o));return true;},sel);
async function pickV(page, sel, text) { await openV(page,sel); await page.waitForTimeout(400); for(let p=0;p<60;p++){const ok=await page.evaluate((t)=>{const sc=document.querySelector('[data-virtuoso-scroller="true"]');if(!sc)return false;for(const r of [...sc.querySelectorAll("[data-index]")])if((r.textContent||"").trim()===t){((r.firstElementChild)||r).click();return true;}sc.scrollTop+=sc.clientHeight*0.7;return false;},text);if(ok)return true;await page.waitForTimeout(120);}return false; }
const fieldVal = (page, sel) => page.evaluate((s)=>{const e=document.querySelector(s);return e?e.value:null;}, sel);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" })).newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${ORIGIN}/`,{waitUntil:"networkidle"});
  await clickPT(page,"Languages");await page.waitForTimeout(700);await clickPT(page,"English");
  await page.waitForLoadState("networkidle").catch(()=>{});await page.waitForTimeout(1200);
  for(let i=0;i<20;i++){if(await clickPT(page,"Foreign Visitor"))break;await page.waitForTimeout(400);}
  await page.waitForURL(/personal-information/);await page.waitForLoadState("networkidle").catch(()=>{});await page.waitForTimeout(1200);
  await pickV(page,'[id^="spi_nationality_"]',"UNITED STATES OF AMERICA");
  await page.fill('[id^="spi_full_name_"]',"TEST RECON");await page.fill('[id^="spi_dob_"]',"15/01/1990");
  await pickV(page,'[id^="spi_country_or_place_of_birth_"]',"UNITED STATES OF AMERICA");
  await page.evaluate(()=>{const i=[...document.querySelectorAll("input")].find(x=>x.value==="MALE");let n=i;for(let k=0;k<6&&n;k++,n=n.parentElement)if(getComputedStyle(n).cursor==="pointer"){n.click();return;}i&&i.click();});
  await page.fill('[id^="spi_passport_no_"]',"X0000001");await page.fill('[id^="spi_date_of_passport_expiry_"]',"31/12/2030");
  await page.fill('[id^="spi_mobile_no_"]',"5551234567");await page.fill('[id^="spi_email_"]',"arrivalpass.smoke@gmail.com");
  await clickPT(page,"Next");await page.waitForURL(/travel-details/,{timeout:15000}).catch(()=>{});
  await page.waitForLoadState("networkidle").catch(()=>{});await page.waitForTimeout(1500);
  console.log("on:", page.url(), "arrival before:", await fieldVal(page,"#std_arrival_date_foreigner_individual"));

  await openV(page,"#std_arrival_date_foreigner_individual");await page.waitForTimeout(700);
  // dump row html
  const rowHtml = await page.evaluate(()=>{const sc=document.querySelector('[data-virtuoso-scroller="true"]');if(!sc)return null;const r=[...sc.querySelectorAll("[data-index]")].find(x=>(x.textContent||"").trim()==="10 JUNE 2026");return r?r.outerHTML.slice(0,400):"row-not-found";});
  console.log("row html:", rowHtml);

  // method A: Playwright real click on the row
  const loc = page.locator('[data-virtuoso-scroller="true"] [data-index]', { hasText: "10 JUNE 2026" }).first();
  await loc.click({ force: true }).catch((e)=>console.log("A click err:", e.message));
  await page.waitForTimeout(600);
  console.log("after Playwright click, arrival:", await fieldVal(page,"#std_arrival_date_foreigner_individual"));

  await browser.close();
})().catch((e)=>{console.error("crashed:",e.message);process.exit(1);});
