/* Vault Zine — dynamic mags + tactile page turn (GitHub Pages friendly) */

const MAX_MAGS_TO_PROBE = 60;     // tries mag1..mag60
const MAX_MISSES = 6;             // stop after N missing mags in a row
const MAG_PREFIX = "mag";
const MANIFEST_NAME = "manifest.json";
const LS_KEY = "vaultzine.reader.v1"; // {magId, pageIdx}

const stage = document.getElementById("stage");
const page = document.getElementById("page");
const under = document.getElementById("under");
const pageImg = document.getElementById("pageImg");
const underImg = document.getElementById("underImg");
const shade = document.getElementById("shade");

const label = document.getElementById("label");
const headline = document.getElementById("headline");
const pageNum = document.getElementById("pageNum");
const counter = document.getElementById("counter");
const dots = document.getElementById("dots");
const backStamp = document.getElementById("backStamp");
const zineTitle = document.getElementById("zineTitle");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

// runtime state
let MAGS = [];                // [{id,title,pages:[{src,headline}]}]
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

async function fetchJSON(url){
  const r = await fetch(url, { cache: "no-store" });
  if(!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.json();
}

async function tryLoadMag(magId){
  const base = `${MAG_PREFIX}${magId}`;
  const url = `${base}/${MANIFEST_NAME}`;
  const data = await fetchJSON(url);

  const pages = (data.pages || []).map((p, i)=>({
    src: `${base}/${p.src}`,
    headline: p.headline || `Page ${i+1}`
  }));
  if(!pages.length) throw new Error(`Empty pages in ${url}`);

  return { id: magId, title: data.title || `Magazine ${magId}`, pages };
}

async function discoverMags(){
  const mags = [];
  let misses = 0;

  for(let id=1; id<=MAX_MAGS_TO_PROBE; id++){
    try{
      const mag = await tryLoadMag(id);
      mags.push(mag);
      misses = 0;
    }catch{
      misses++;
      if(misses >= MAX_MISSES) break;
    }
  }
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

function resetTransforms(immediate=false){
  page.style.transition = immediate ? "none" : "transform .22s ease";
  shade.style.transition = immediate ? "none" : "opacity .15s ease";
  shade.style.opacity = "0";
  page.style.transform = `translateZ(0) rotateY(0deg) translateX(0px)`;
  if(immediate){
    page.style.transformOrigin = "100% 50%";
    requestAnimationFrame(()=>{ page.style.transition = "transform .22s ease"; });
  }
  underImg.style.filter = "none";
  if(!immediate){
    // After snap-back, reset origin to default for next drag
    setTimeout(()=>{ page.style.transformOrigin = "100% 50%"; }, 260);
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

  pageImg.src = current.src;

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

  // anchor to first touch position
  originX = clamp(x / rect.width * 100, 0, 100);
  originY = clamp(y / rect.height * 100, 0, 100);
  page.style.transformOrigin = `${originX}% ${originY}%`;

  page.style.transition = "none";
  shade.style.transition = "none";
  shade.style.opacity = "1";

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

  // Paper-like: fold follows finger (origin already at touch); more curl, less slide
  const resist = (dir === 0) ? 0.4 : 1;
  const rotate = clamp(-norm * 120 * resist, -120, 120);
  const translate = clamp(dx * 0.55 * resist, -rect.width*0.85, rect.width*0.85);
  const z = Math.abs(norm) * 50;

  page.style.transform = `translateZ(${z}px) rotateY(${rotate}deg) translateX(${translate}px)`;

  const sh = clamp(Math.abs(norm) * 1.1, 0, 1);
  shade.style.opacity = String(0.10 + sh * 0.85);
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

  page.style.transition = "transform .24s cubic-bezier(.2,.9,.2,1)";
  shade.style.transition = "opacity .18s ease";

  if(commit){
    // Flip away from the same anchor point the user dragged from (natural paper feel)
    page.style.transformOrigin = `${originX}% ${originY}%`;
    page.style.transition = "transform .24s cubic-bezier(.2,.9,.2,1)";
    const off = (dir === +1) ? -rect.width*1.25 : rect.width*1.25;
    const rot = (dir === +1) ? 120 : -120;
    page.style.transform = `translateZ(60px) rotateY(${rot}deg) translateX(${off}px)`;
    shade.style.opacity = "0";

    setTimeout(()=> commitTurn(dir), 210);
  }else{
    resetTransforms(false);
  }
}

// prevent overscroll while dragging
document.addEventListener("touchmove", (e)=>{
  if(dragging) e.preventDefault();
}, { passive:false });

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

// init
(async function init(){
  const mags = await discoverMags();
  if(!mags.length){
    counter.textContent = "No mags found";
    zineTitle.textContent = "Vault Zine — No magazines found";
    headline.textContent = "Add mag1/manifest.json";
    return;
  }
  MAGS = mags;

  const choice = chooseClosest();
  setMag(choice.magIndex, choice.pageIdx);
})();
