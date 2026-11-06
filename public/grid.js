// Karten-Raster mit stabilen DOM-Elementen (kein komplettes Neuzeichnen bei jedem Update).
// Dadurch sind Flip-Animation beim Reveal, "Karte fliegt ins Deck" und weiche Uebergaenge moeglich.

const panFromX = x => Math.max(-0.85, Math.min(0.85, (x / Math.max(1, innerWidth)) * 2 - 1));
const panOfEl = el => { const r = el.getBoundingClientRect(); return panFromX(r.left + r.width / 2); };
const cardOf = el => (latest?.cards || []).find(x => String(x.uid || x.id) === el.dataset.id);

// ---------- Bilder vorladen ----------
const preloaded = new Set();
function preloadImages(urls) {
  for (const u of urls || []) {
    if (!u || preloaded.has(u)) continue;
    preloaded.add(u);
    const im = new Image(); im.decoding = "async"; im.src = u;
  }
}
// Grosse Abbildung (Hover-Panel) kurz nach dem Reveal im Hintergrund laden
const largeQueued = new Set();
function preloadLarge(cards) {
  const list = (cards || []).filter(c => c.image && !largeQueued.has(c.image));
  if (!list.length) return;
  list.forEach(c => largeQueued.add(c.image));
  setTimeout(() => preloadImages(list.map(c => c.image.replace("/cards_small/", "/cards/"))), 600);
}

// ---------- Hover-Panel ----------
let hoverKey = null, hoverEl = null;
function showDraftHover(c) {
  const k = (!c || latest?.room?.phase !== "draft") ? "" : String(c.uid || c.id);
  if (k === hoverKey) return;      // gleiche Karte: Panel nicht neu aufbauen (kein Flackern)
  hoverKey = k;
  $("draftHoverPanel").innerHTML = k
    ? cardLargeImg(c) + cardInfoHtml(c)
    : '<div class="hoverEmpty">Fahre mit der Maus über eine Karte, um Effekt und Kartendaten hier anzuzeigen.</div>';
}
// Zeigt die Karte unter dem Mauszeiger (z. B. direkt nach Rundenstart oder nach dem Labyrinth, ohne Mausbewegung)
function refreshHover() {
  if (!ptrKnown || latest?.room?.phase !== "draft") { showDraftHover(null); return; }
  const el = document.elementFromPoint(ptr.x, ptr.y)?.closest?.(".draftCard");
  const c = el && cardOf(el);
  showDraftHover(c && !c.hidden && !c.destroyed ? c : null);
}

// ---------- Karten-Element ----------
function createCardEl() {
  const el = document.createElement("article");
  el.className = "card draftCard";
  el.innerHTML = '<div class="cardInner"><div class="cardBack"><span>BLITZ<br>DRAFT</span></div>' +
    '<div class="cardFront"><img class="cardImg" alt="" decoding="async"><div class="hiddenCardFace">VERDECKT</div><div class="cardOverlay"></div></div></div>';
  return el;
}

function flyToDeck(el) {
  const r = el.getBoundingClientRect(), d = $("deck")?.getBoundingClientRect(), src = el.querySelector(".cardImg")?.src;
  if (!d || !src) return;
  const f = document.createElement("div");
  f.className = "flyCard";
  f.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  f.innerHTML = `<img src="${escapeAttr(src)}" alt="">`;
  fxLayer().appendChild(f);
  const tx = d.left + d.width / 2 - (r.left + r.width / 2), ty = d.top + 40 - (r.top + r.height / 2);
  f.animate([
    { transform: "translate(0,0) scale(1)", opacity: 1, offset: 0 },
    { transform: `translate(${tx * 0.45}px,${ty * 0.45 - 50}px) scale(.8)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${tx}px,${ty}px) scale(.22)`, opacity: 0.25, offset: 1 },
  ], { duration: 700, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
  setTimeout(() => f.remove(), 760);
}

function onPickedCard(el, ownerId) {
  el.classList.remove("justPicked"); void el.offsetWidth; el.classList.add("justPicked");
  setTimeout(() => el.classList.remove("justPicked"), 700);
  if (ownerId === me) flyToDeck(el);
  else sfx.tickOther(panOfEl(el));     // leises Ticken bei Picks anderer, links/rechts nach Kartenposition
}

function updateCardEl(el, c, s, faceUp, blocked, i, n) {
  const id = String(c.uid || c.id), cl = el.classList;
  el.dataset.id = id;
  const gone = c.destroyed === "gone", burnt = c.destroyed === "burnt";
  const swapping = !!swapHold && Date.now() < swapHold.until && swapHold.uids.has(id);
  const picked = !!c.pickedBy && !swapping && !gone && !burnt;
  const owner = picked ? s.players.find(p => p.id === c.pickedBy) : null;
  const wallColor = c.hidden && c.hiddenBy ? s.players.find(p => p.id === c.hiddenBy)?.color : "";

  cl.toggle("goneCard", gone);
  cl.toggle("burntCard", burnt);
  cl.toggle("hiddenCard", !!c.hidden && !gone && !burnt);
  cl.toggle("picked", picked);
  cl.toggle("revealed", faceUp || burnt);
  cl.toggle("wallBlocked", blocked.has(id));
  cl.toggle("swapping", swapping);
  cl.toggle("ghostCard", picked && !!c.ghost);
  // Flip-Kaskade: Karten drehen sich leicht versetzt um
  el.style.setProperty("--flip-delay", `${Math.round(i * Math.min(55, 600 / Math.max(1, n)))}ms`);
  if (!cl.contains("mazeMoving")) {
    if (picked && owner) el.style.setProperty("--owner-color", owner.color); else el.style.removeProperty("--owner-color");
  }
  if (wallColor) el.style.setProperty("--wall-color", wallColor); else el.style.removeProperty("--wall-color");

  // Abbildung nur setzen, wenn sie sich wirklich aendert (verhindert Flackern)
  const img = el.querySelector(".cardImg");
  if (!c.hidden && c.image) {
    if (img.dataset.src !== c.image) { img.dataset.src = c.image; img.src = c.image; }
    img.alt = c.name || "";
  } else if (c.concealed && img.dataset.src) {
    delete img.dataset.src; img.removeAttribute("src");
  }

  // Overlay (Pick-Badge, Geist, verkohlt, Undo) nur bei Aenderung neu schreiben
  const undoable = picked && s.room.allowUndo && owner?.id === me && s.room.phase === "draft" && !c.ghost;
  const sig = [burnt ? "b" : "", picked ? `${owner?.id}|${owner?.name}|${owner?.color}` : "", picked && c.ghost ? "g" : "", picked && c.ghostPending ? "p" : "", undoable ? "u" : ""].join("~");
  if (el._sig !== sig) {
    el._sig = sig;
    let h = "";
    if (burnt) h += '<div class="burntMark">⚡</div>';
    if (picked && c.ghost) h += '<div class="ghostMark">👻</div>';
    if (picked) h += `<div class="pickedBadge" style="background:${owner?.color || "#fff"}">${c.ghost ? `👻 ${escapeHtml(owner?.name || "")}${c.ghostPending ? " · nächste Runde" : ""}` : `✓ ${escapeHtml(owner?.name || "")}`}</div>`;
    if (undoable) h += '<button type="button" class="undoPick" data-undo-pick title="Pick zurücknehmen">↩</button>';
    el.querySelector(".cardOverlay").innerHTML = h;
  }

  // Effekte, wenn ein Pick neu hinzukommt (nicht beim ersten Zeichnen, nicht bei Geist/Tausch/Labyrinth)
  const prevOwner = el._owner ?? null, newOwner = picked ? (owner?.id || null) : null;
  if (el._seen && faceUp && newOwner && !prevOwner && !c.ghost && s.room.phase === "draft") onPickedCard(el, newOwner);
  el._owner = newOwner; el._seen = true;
}

function renderGrid(s) {
  const grid = $("grid"), cards = s.cards || [], n = cards.length;
  const faceUp = s.room.phase === "draft", blocked = new Set(s.blockedUids || []);
  const els = [...grid.children].filter(e => e.classList?.contains("draftCard"));
  const byKey = new Map(els.map(e => [e.dataset.key, e]));
  const keys = cards.map((c, i) => c.concealed ? `c${i}` : String(c.uid || c.id));
  const keySet = new Set(keys);
  // Elemente, deren Karte verschwunden ist, werden fuer neue Karten wiederverwendet:
  // so dreht sich beim Reveal dasselbe Element um (Flip) statt neu zu erscheinen
  const spare = els.filter(e => !keySet.has(e.dataset.key));
  const plan = cards.map((c, i) => {
    let el = byKey.get(keys[i]), isNew = false;
    if (!el) { el = spare.shift(); if (!el) { el = createCardEl(); isNew = true; } }
    el.dataset.key = keys[i];
    return { el, c, i, isNew };
  });
  spare.forEach(e => e.remove());
  plan.forEach(({ el, c, i }) => {
    updateCardEl(el, c, s, faceUp, blocked, i, n);      // erst aktualisieren, dann einfuegen (kein ungewollter Flip)
    const cur = grid.children[i];
    if (cur !== el) grid.insertBefore(el, cur || null);
  });
  if (faceUp) preloadLarge(cards.filter(c => !c.hidden && !c.destroyed));
}

// ---------- Delegierte Ereignisse (Elemente bleiben bestehen, Listener nur einmal) ----------
(function () {
  const grid = document.getElementById("grid");
  grid.addEventListener("mouseover", e => {
    const el = e.target.closest?.(".draftCard");
    if (!el || el === hoverEl) return;
    hoverEl = el;
    const c = cardOf(el);
    showDraftHover((c?.hidden || c?.destroyed) ? null : c);
  });
  grid.addEventListener("mouseleave", () => { hoverEl = null; showDraftHover(null); });
  grid.addEventListener("click", e => {
    const undo = e.target.closest?.("[data-undo-pick]");
    if (undo) { e.stopPropagation(); ws?.send(JSON.stringify({ type: "undoPick", cardId: undo.closest(".draftCard").dataset.id })); return; }
    const el = e.target.closest?.(".draftCard");
    if (!el || el.classList.contains("burntCard") || el.classList.contains("goneCard")) return;
    const free = !el.classList.contains("picked") && !el.classList.contains("hiddenCard");
    if (latest?.room?.phase === "draft" && free) {
      ws?.send(JSON.stringify({ type: "pick", cardId: el.dataset.id }));
      sfx.pick(panOfEl(el));
    } else if (free) {
      el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake");
    }
  });
})();
