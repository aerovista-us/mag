/* Vault Zine — dynamic mags + tactile page turn (GitHub Pages friendly) */

const AUTH_ORIGIN = "https://mag-auth.aerovista.us";
const CATALOG_URL = "./catalog.json";
const LS_KEY = "vaultzine.reader.v1"; // {magId, pageIdx}

const stage = document.getElementById("stage");
const page = document.getElementById("page");
const under = document.getElementById("under");
const underImg = document.getElementById("underImg");
const shade = document.getElementById("shade");
const stripInners = document.querySelectorAll(".page-strip-inner");
const stripImgs = document.querySelectorAll(".page-strip-img");
const foldEdgeA = document.getElementById("foldEdgeA");
const foldPeak = document.getElementById("foldPeak");
const foldEdgeB = document.getElementById("foldEdgeB");
const feBend = document.getElementById("feBend");

const label = document.getElementById("label");
const headline = document.getElementById("headline");
const pageNum = document.getElementById("pageNum");
const counter = document.getElementById("counter");
const dots = document.getElementById("dots");
const backStamp = document.getElementById("backStamp");
const zineTitle = document.getElementById("zineTitle");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const readerGate = document.getElementById("readerGate");
const issueShelf = document.getElementById("issueShelf");
const readerLogin = document.getElementById("readerLogin");
const readerRegister = document.getElementById("readerRegister");
const accountLabel = document.getElementById("accountLabel");
const accountAction = document.getElementById("accountAction");
const accountPill = document.getElementById("accountPill");

// runtime state
let MAGS = [];                // authenticated issues [{id,title,pages:[{src,headline}]}]
let CATALOG = [];             // public metadata only
let MAG_SESSION = null;       // safe identity + CSRF projection, never the AVCC token
let currentMagIndex = 0;
let PAGES = [];
let idx = 0;

// drag state
let dragging = false;
let startX = 0;
let startY = 0;
let lastX = 0;
let lastT = 0;
let vx = 0;
let dir = 0; // -1 prev (drag right), +1 next (drag left)
let originX = 0;
let originY = 0;

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function getQueryInt(name){
  const u = new URL(location.href);
  const v = u.searchParams.get(name);
  if(!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function loadProgress(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY) || "null"); }
  catch{ return null; }
}
function saveProgress(){
  const magId = MAGS[currentMagIndex]?.id ?? 1;
  localStorage.setItem(LS_KEY, JSON.stringify({ magId, pageIdx: idx }));
}

async function fetchJSON(url, options = {}){
  const r = await fetch(url, { cache: "no-store", ...options });
  const data = await r.json().catch(() => ({}));
  if(!r.ok){
    const error = new Error(data?.error || `HTTP ${r.status} ${url}`);
    error.status = r.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function currentReaderNext(){
  return location.pathname + location.search + location.hash;
}

function accountRoute(kind){
  return `${AUTH_ORIGIN}/${kind}?next=${encodeURIComponent(currentReaderNext())}`;
}

async function loadCatalog(){
  const data = await fetchJSON(CATALOG_URL);
  CATALOG = Array.isArray(data?.issues) ? data.issues : [];
  return CATALOG;
}

function renderIssueShelf(){
  if(!issueShelf) return;
  issueShelf.innerHTML = "";
  if(!CATALOG.length){
    issueShelf.innerHTML = '<p class="issue-empty">No issues are published yet.</p>';
    return;
  }
  for(const issue of CATALOG){
    const card = document.createElement("article");
    card.className = "issue-card";
    card.innerHTML = `
      <div class="issue-number">ISSUE ${String(issue.number || issue.id || "").padStart(2, "0")}</div>
      <h2>${escapeHtml(issue.title || "AeroVista Magazine")}</h2>
      <p>${escapeHtml(issue.description || "An AeroVista magazine issue.")}</p>
      <div class="issue-card-footer">
        <span class="issue-lock">Account required to read</span>
        <button type="button" class="issue-open">Open issue</button>
      </div>`;
    card.querySelector(".issue-open").addEventListener("click", () => {
      const magNumber = Number(issue.number || issue.id || 1);
      if(MAG_SESSION?.authenticated){
        const target = new URL(location.href);
        target.searchParams.set("mag", String(magNumber));
        history.pushState({}, "", target);
        initializeAuthenticatedReader().catch(showReaderUnavailable);
      }else{
        location.href = accountRoute("login");
      }
    });
    issueShelf.appendChild(card);
  }
}

function setAccountUi(session){
  MAG_SESSION = session;
  const authenticated = session?.authenticated === true;
  accountPill?.classList.toggle("is-authenticated", authenticated);
  if(accountLabel){
    accountLabel.textContent = authenticated
      ? (session.identity?.name || session.identity?.email || "AeroVista member")
      : "Account required to read";
  }
  if(accountAction){
    accountAction.hidden = false;
    accountAction.textContent = authenticated ? "Sign out" : "Log in";
  }
}

function showAccountGate(){
  readerGate.hidden = false;
  stage?.setAttribute("aria-hidden", "true");
  renderIssueShelf();
}

function hideAccountGate(){
  readerGate.hidden = true;
  stage?.removeAttribute("aria-hidden");
}

function showReaderUnavailable(error){
  console.warn("[mag] reader unavailable:", error?.message || error);
  counter.textContent = "Reader unavailable";
  zineTitle.textContent = "AeroVista Magazines";
  headline.textContent = "Please try again";
}

async function checkMagazineSession(){
  const data = await fetchJSON(`${AUTH_ORIGIN}/api/session`, { credentials: "include" });
  setAccountUi(data);
  return data;
}

async function loadProtectedIssue(issue){
  const slug = issue.slug || `mag${issue.number || issue.id}`;
  const data = await fetchJSON(`${AUTH_ORIGIN}/api/mags/${encodeURIComponent(slug)}/manifest`, {
    credentials: "include",
  });
  const pages = (data.pages || []).map((page, i) => ({
    src: page.src,
    headline: page.headline || `Page ${i + 1}`,
  }));
  if(!pages.length) throw new Error("Protected issue has no pages");
  return {
    id: Number(issue.number || issue.id),
    slug,
    title: data.title || issue.title || `Magazine ${issue.number || issue.id}`,
    pages,
  };
}

async function discoverMags(){
  const mags = [];
  for(const issue of CATALOG) mags.push(await loadProtectedIssue(issue));
  return mags;
}

function chooseClosest(){
  // 1) URL ?mag=# (optional)
  const urlMag = getQueryInt("mag");
  if(urlMag){
    const k = MAGS.findIndex(m => m.id === urlMag);
    if(k !== -1) return { magIndex: k, pageIdx: 0 };
  }

  // 2) localStorage resume
  const saved = loadProgress();
  if(saved?.magId != null){
    const k = MAGS.findIndex(m => m.id === saved.magId);
    if(k !== -1){
      return {
        magIndex: k,
        pageIdx: clamp(saved.pageIdx ?? 0, 0, MAGS[k].pages.length - 1)
      };
    }
  }

  return { magIndex: 0, pageIdx: 0 };
}

function setMag(magIndex, pageIndex=0){
  currentMagIndex = clamp(magIndex, 0, MAGS.length - 1);
  PAGES = MAGS[currentMagIndex].pages;
  idx = clamp(pageIndex, 0, PAGES.length - 1);

  zineTitle.textContent = `Vault Zine — ${MAGS[currentMagIndex].title}`;
  render();
  saveProgress();
}

function buildDots(){
  dots.innerHTML = "";
  for(let i=0;i<PAGES.length;i++){
    const d = document.createElement("div");
    d.className = "dot" + (i===idx ? " active":"");
    dots.appendChild(d);
  }
}

function setMeta(){
  const mag = MAGS[currentMagIndex];
  const magLabel = mag ? `Mag ${mag.id}` : "Mag ?";
  counter.textContent = `${magLabel} · ${idx+1} / ${PAGES.length}`;
  label.textContent = mag?.title ?? "Vault Zine";
  headline.textContent = PAGES[idx]?.headline ?? "—";
  pageNum.textContent = `Pg ${idx+1}`;
  backStamp.textContent = `PAGE ${idx+1}`;

  [...dots.children].forEach((d,i)=> d.classList.toggle("active", i===idx));
}

function updateButtons(){
  prevBtn.disabled = (idx === 0 && currentMagIndex === 0);
  nextBtn.disabled = (idx === PAGES.length - 1 && currentMagIndex === MAGS.length - 1);
  prevBtn.style.opacity = prevBtn.disabled ? .35 : 1;
  nextBtn.style.opacity = nextBtn.disabled ? .35 : 1;
}

function preload(src){
  return new Promise((res, rej)=>{
    const im = new Image();
    im.onload = ()=>res(src);
    im.onerror = ()=>rej(new Error("Failed to load " + src));
    im.src = src;
  });
}

async function handleProtectedAssetFailure(){
  try{
    const session = await checkMagazineSession();
    if(!session.authenticated){
      MAGS = [];
      PAGES = [];
      showAccountGate();
    }
  }catch(error){
    showReaderUnavailable(error);
  }
}

function resetTransforms(immediate=false){
  page.style.transition = immediate ? "none" : "transform .32s cubic-bezier(.34, 1.2, .42, 1)";
  shade.style.transition = immediate ? "none" : "opacity .2s ease";
  shade.style.opacity = "0";
  page.style.transform = "translateZ(0) rotateX(0deg) translateX(0px)";
  stripInners.forEach((el) => { el.style.transition = immediate ? "none" : "transform .28s cubic-bezier(.3, 1.1, .4, 1)"; el.style.transform = "translateZ(0) rotateX(0deg) rotateY(0deg)"; });
  page.style.removeProperty("--fold-opacity");
  if (feBend) feBend.setAttribute("scale", "0");
  if(immediate){
    page.style.transformOrigin = "0% 50%";
    requestAnimationFrame(()=>{ page.style.transition = "transform .26s cubic-bezier(.25,.85,.35,1)"; });
  }
  underImg.style.filter = "none";
  if(!immediate){
    setTimeout(()=>{ page.style.transformOrigin = "0% 50%"; }, 340);
  }
}

function setUnderForDirection(d){
  let targetSrc = PAGES[idx].src;

  if(d === +1){
    if(idx < PAGES.length - 1){
      targetSrc = PAGES[idx + 1].src;
    }else if(currentMagIndex < MAGS.length - 1){
      targetSrc = MAGS[currentMagIndex + 1].pages[0].src;
    }
  }else{
    if(idx > 0){
      targetSrc = PAGES[idx - 1].src;
    }else if(currentMagIndex > 0){
      const pm = MAGS[currentMagIndex - 1];
      targetSrc = pm.pages[pm.pages.length - 1].src;
    }
  }

  underImg.src = targetSrc;
  underImg.style.filter = "saturate(.95) contrast(.98) brightness(.98)";
}

async function render(){
  const current = PAGES[idx];
  if(!current) return;

  // preload current + next best-effort
  const maybeNext = (idx < PAGES.length-1) ? PAGES[idx+1]?.src :
                   (currentMagIndex < MAGS.length-1 ? MAGS[currentMagIndex+1].pages[0].src : null);

  await Promise.allSettled([
    preload(current.src),
    maybeNext ? preload(maybeNext) : Promise.resolve()
  ]);

  stripImgs.forEach((img) => (img.src = current.src));

  // under defaults to next page (or next mag first page)
  if(idx < PAGES.length - 1){
    underImg.src = PAGES[idx+1].src;
  }else if(currentMagIndex < MAGS.length - 1){
    underImg.src = MAGS[currentMagIndex+1].pages[0].src;
  }else if(idx > 0){
    underImg.src = PAGES[idx-1].src;
  }else{
    underImg.src = current.src;
  }

  resetTransforms(true);
  buildDots();
  setMeta();
  updateButtons();
}

function commitTurn(d){
  // d: +1 next, -1 prev
  if(d === +1){
    if(idx < PAGES.length - 1){
      idx++;
      render();
      saveProgress();
    }else if(currentMagIndex < MAGS.length - 1){
      setMag(currentMagIndex + 1, 0);
    }else{
      render();
    }
  }else{
    if(idx > 0){
      idx--;
      render();
      saveProgress();
    }else if(currentMagIndex > 0){
      const prevMag = currentMagIndex - 1;
      setMag(prevMag, MAGS[prevMag].pages.length - 1);
    }else{
      render();
    }
  }
}

// ----------------------
// Tactile page turn
// ----------------------

function getPoint(e){
  if(e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function startDrag(e){
  if(e.button !== undefined && e.button !== 0) return;
  if(MAGS.length <= 0 || PAGES.length <= 1 && MAGS.length <= 1) return;

  const pt = getPoint(e);
  if(pt.x == null) return;
  e.preventDefault?.();

  const rect = page.getBoundingClientRect();
  const x = pt.x - rect.left;
  const y = pt.y - rect.top;

  dragging = true;
  startX = pt.x;
  startY = pt.y;
  lastX = pt.x;
  lastT = performance.now();
  vx = 0;
  dir = 0;

  originY = clamp((y / rect.height) * 100, 0, 100);
  page.style.transformOrigin = "0% 50%";

  page.style.transition = "none";
  shade.style.transition = "none";
  shade.style.opacity = "1";
  stripInners.forEach((el) => { el.style.transition = "none"; });
  if (feBend) feBend.setAttribute("scale", "0");

  if(e.pointerId !== undefined) page.setPointerCapture?.(e.pointerId);
}

function moveDrag(e){
  if(!dragging) return;
  const pt = getPoint(e);
  e.preventDefault?.();
  const px = pt.x;
  const dx = px - startX;

  if(dir === 0 && Math.abs(dx) > 8){
    dir = dx < 0 ? +1 : -1;

    // block invalid direction at bounds
    if((dir === +1 && idx === PAGES.length-1 && currentMagIndex === MAGS.length-1) ||
       (dir === -1 && idx === 0 && currentMagIndex === 0)){
      dir = 0;
    }else{
      setUnderForDirection(dir);
    }
  }

  // velocity
  const now = performance.now();
  const dt = Math.max(8, now - lastT);
  vx = (px - lastX) / dt; // px/ms
  lastX = px;
  lastT = now;

  const rect = page.getBoundingClientRect();
  const norm = clamp(dx / rect.width, -1, 1);

  const resist = (dir === 0) ? 0.45 : 1;
  const eased = norm * (0.7 + 0.3 * Math.abs(norm));
  const liftZ = Math.abs(norm) * 72;
  const slideX = clamp(dx * 0.18 * resist, -rect.width * 0.35, rect.width * 0.35);
  const tiltX = (0.5 - originY / 100) * 14 * Math.sign(norm);
  const rotateX = clamp(tiltX, -12, 12);

  page.style.transform = `translateZ(${liftZ}px) rotateX(${rotateX}deg) translateX(${slideX}px)`;

  const NUM_STRIPS = stripInners.length;
  const maxCurl = 88 * resist;
  const flap = (0.5 - originY / 100) * 1.2;
  for (let i = 0; i < NUM_STRIPS; i++) {
    const stripCenter = ((i + 0.5) / NUM_STRIPS) * 100;
    const tRaw = stripCenter / 100;
    const t = tRaw * tRaw * (3 - 2 * tRaw);
    const curl = t * maxCurl * Math.abs(eased);
    const rotY = -norm * curl;
    const rotX = flap * (1 - t) * 6 * Math.sign(norm);
    const lift = t * t * 4;
    stripInners[i].style.transform = `translateZ(${lift}px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  }

  const sh = clamp(Math.abs(norm) * 1.15, 0, 1);
  shade.style.opacity = String(0.12 + sh * 0.82);
  page.style.setProperty("--fold-opacity", String(0.12 + sh * 0.6));
  if (foldEdgeA && foldPeak && foldEdgeB) {
    foldEdgeA.setAttribute("offset", "0");
    foldPeak.setAttribute("offset", "0.02");
    foldEdgeB.setAttribute("offset", "0.04");
  }
  if (feBend) feBend.setAttribute("scale", String(0.5 + Math.abs(norm) * 2.2));
}

function endDrag(){
  if(!dragging) return;
  dragging = false;

  const rect = page.getBoundingClientRect();
  const dx = lastX - startX;
  const norm = clamp(dx / rect.width, -1, 1);

  const flick = Math.abs(vx) > 0.9;
  const distCommit = Math.abs(norm) > 0.28;

  let commit = false;
  if(dir !== 0){
    const aligned = (dir === +1 && dx < 0) || (dir === -1 && dx > 0);
    commit = aligned && (distCommit || flick);
  }

  if(commit){
    stripInners.forEach((el) => { el.style.transition = "none"; el.style.transform = "rotateY(0deg)"; });
    page.style.transformOrigin = "0% 50%";
    page.style.transition = "transform .3s cubic-bezier(.2,.85,.35,1)";
    shade.style.transition = "opacity .2s ease";
    const tilt = (0.5 - originY / 100) * 8 * (dir === +1 ? 1 : -1);
    const drift = (dir === +1 ? -1 : 1) * rect.width * 0.28;
    page.style.transform = `translateZ(75px) rotateX(${tilt}deg) rotateY(${dir === +1 ? 115 : -115}deg) translateX(${drift}px)`;
    shade.style.opacity = "0";
    setTimeout(()=> commitTurn(dir), 280);
  }else{
    page.style.transition = "transform .32s cubic-bezier(.34, 1.2, .42, 1)";
    shade.style.transition = "opacity .2s ease";
    resetTransforms(false);
  }
}

// prevent overscroll while dragging
document.addEventListener("touchmove", (e)=>{
  if(dragging) e.preventDefault();
}, { passive:false });

stripImgs.forEach((img) => img.addEventListener("error", handleProtectedAssetFailure));
underImg.addEventListener("error", handleProtectedAssetFailure);

// pointer events
page.addEventListener("pointerdown", startDrag);
page.addEventListener("pointermove", moveDrag);
page.addEventListener("pointerup", endDrag);
page.addEventListener("pointercancel", endDrag);
page.addEventListener("pointerleave", ()=>{ if(dragging) endDrag(); });

// Touch fallback (iOS Safari sometimes prefers touch events)
page.addEventListener("touchstart", (e)=> startDrag(e), { passive: false });
page.addEventListener("touchmove",  (e)=> moveDrag(e),  { passive: false });
page.addEventListener("touchend",   ()=> endDrag());
page.addEventListener("touchcancel", ()=> endDrag());

// buttons
prevBtn.addEventListener("click", ()=>{
  if(idx > 0){
    idx--;
    render();
    saveProgress();
  }else if(currentMagIndex > 0){
    const pm = currentMagIndex - 1;
    setMag(pm, MAGS[pm].pages.length - 1);
  }
});

nextBtn.addEventListener("click", ()=>{
  if(idx < PAGES.length - 1){
    idx++;
    render();
    saveProgress();
  }else if(currentMagIndex < MAGS.length - 1){
    setMag(currentMagIndex + 1, 0);
  }
});

async function initializeAuthenticatedReader(){
  const session = MAG_SESSION?.authenticated ? MAG_SESSION : await checkMagazineSession();
  if(!session.authenticated){
    showAccountGate();
    return;
  }
  hideAccountGate();
  const mags = await discoverMags();
  if(!mags.length){
    counter.textContent = "No issues found";
    zineTitle.textContent = "AeroVista Magazines";
    headline.textContent = "No published issues";
    return;
  }
  MAGS = mags;
  const choice = chooseClosest();
  setMag(choice.magIndex, choice.pageIdx);
}

readerLogin?.addEventListener("click", () => { location.href = accountRoute("login"); });
readerRegister?.addEventListener("click", () => { location.href = accountRoute("register"); });
accountAction?.addEventListener("click", async () => {
  if(!MAG_SESSION?.authenticated){
    location.href = accountRoute("login");
    return;
  }
  try{
    await fetchJSON(`${AUTH_ORIGIN}/api/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Mag-CSRF": MAG_SESSION.csrfToken || "" },
    });
  }finally{
    setAccountUi({ authenticated: false, identity: null });
    MAGS = [];
    PAGES = [];
    showAccountGate();
  }
});

window.addEventListener("popstate", () => {
  if(MAG_SESSION?.authenticated) initializeAuthenticatedReader().catch(showReaderUnavailable);
});

(async function init(){
  try{
    await loadCatalog();
    renderIssueShelf();
    const session = await checkMagazineSession();
    if(!session.authenticated){
      showAccountGate();
      return;
    }
    await initializeAuthenticatedReader();
  }catch(error){
    if(error?.status === 401){
      setAccountUi({ authenticated: false, identity: null });
      showAccountGate();
      return;
    }
    showReaderUnavailable(error);
  }
})();
