// Event-Feed, Item-Legende und Bonus-Sterne (Ergebnis-Screen)

// ---------- Event-Feed ----------
function feed(icon, html, color) {
  const box = document.getElementById("eventFeed");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "feedItem";
  el.style.setProperty("--pc", color || "#9aa7ba");
  el.innerHTML = `<span class="feedIcon">${icon}</span><span class="feedText">${html}</span>`;
  box.appendChild(el);
  while (box.children.length > 7) box.firstChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 500); }, 15000);
}

// Text zu einem Item-Effekt (Namen sind bereits escaped)
function feedEffect(m) {
  const who = `<b>${escapeHtml(nameOf(m.playerId))}</b>`, col = colorOf(m.playerId);
  const to = m.to ? `<b>${escapeHtml(nameOf(m.to))}</b>` : "";
  switch (m.effect) {
    case "collect": feed(ICONS[m.item] || "🎁", `${who} sammelt ${NAMES[m.item] || "ein Item"} ein`, col); break;
    case "wall": feed("🧱", `${who} sperrt eine Reihe/Spalte (10 s)`, col); break;
    case "blitz": feed("⚡", `${who} blitzt ${(m.uids || []).length} Karten weg`, col); break;
    case "explosion": feed("💥", `${who} sprengt eine Karte`, col); break;
    case "swap": feed("♻️", `${who} tauscht: <b>${escapeHtml(nameOf(m.ownerA))}</b> ↔ <b>${escapeHtml(nameOf(m.ownerB))}</b>`, col); break;
    case "maze": feed("🧩", `${who} dreht am Labyrinth`, col); break;
    case "ghost": feed("👻", `${who} aktiviert den Geist`, col); break;
    case "ghostgift": feed("👻", `${who} schenkt ${to} „${escapeHtml(m.name || "eine Karte")}“${m.pending ? " (nächste Runde)" : ""}`, col); break;
    case "ghostdrop": feed("👻", `Geist-Karte „${escapeHtml(m.name || "Karte")}“ landet bei ${to}`, col); break;
  }
}

// ---------- Item-Legende ----------
const LEGEND = [
  ["🧱", "Mauer", "Sperrt 10 Sekunden eine zufällige Reihe oder Spalte für die Gegner (verdeckt). Du siehst die gesperrten Karten markiert."],
  ["⚡", "Blitz", "Zerstört 2–4 zufällige Karten. Gepickte Karten darunter verfallen, die Besitzer müssen neu wählen."],
  ["💥", "Bombe", "Maus über eine Karte fahren, dann Space: Die Karte wird gesprengt. Ein Pick darauf verfällt."],
  ["♻️", "Tausch", "Zwei zufällige Spieler tauschen je eine bereits gewählte Karte."],
  ["🧩", "Labyrinth", "Maus über eine Karte, dann Space: Ihre Reihe und Spalte rutschen 1 Feld. Die Farbmarkierungen bleiben stehen, dadurch wechseln die Picks."],
  ["👻", "Geist", "Dein nächster Klick auf eine Karte geht an einen Gegner. Das kostet dich keinen Pick."],
];
function renderLegend() {
  document.getElementById("legendBody").innerHTML =
    `<ul class="legendBasics"><li>Zu Rundenbeginn fallen Items von oben. Berühre sie mit dem Mauszeiger.</li>
     <li>Du kannst nur <b>ein Item</b> halten. Es kreist um deinen Mauszeiger.</li>
     <li><b>Space</b> (oder der Button) setzt das Item ein. Bei Bombe und Labyrinth zeigt die Maus auf die Zielkarte.</li>
     <li>Am Ende gibt es <b>Bonus-Sterne</b> für besondere Leistungen.</li></ul>` +
    LEGEND.map(([i, n, d]) => `<div class="legendItem"><span class="legendIcon">${i}</span><div><b>${n}</b><p>${d}</p></div></div>`).join("");
}
function toggleLegend(open) {
  const m = document.getElementById("legendModal");
  if (!m) return;
  const show = open ?? m.classList.contains("hidden");
  if (show && !m.dataset.built) { renderLegend(); m.dataset.built = "1"; }
  m.classList.toggle("hidden", !show);
}
document.getElementById("helpBtn")?.addEventListener("click", () => toggleLegend());
document.getElementById("legendClose")?.addEventListener("click", () => toggleLegend(false));
document.getElementById("legendModal")?.addEventListener("click", e => { if (e.target.id === "legendModal") toggleLegend(false); });
window.addEventListener("keydown", e => {
  const tag = document.activeElement?.tagName;
  if (e.key === "Escape") toggleLegend(false);
  else if ((e.key === "?" || (e.key === "/" && e.shiftKey)) && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) toggleLegend();
});

// ---------- Bonus-Sterne ----------
function renderAwards(s) {
  const box = document.getElementById("awards");
  if (!box) return;
  if (s.room.phase !== "finished" || !s.awards) { box.classList.add("hidden"); box.dataset.key = ""; return; }
  const key = JSON.stringify(s.awards);
  if (box.dataset.key === key) return;                  // schon angezeigt, nicht neu aufbauen
  box.dataset.key = key;
  box.classList.remove("hidden");
  const seenKey = `bd_awards_${s.room.id}`;
  const played = sessionStorage.getItem(seenKey) === "1";   // nach Reload/Reconnect ohne Animation
  const { awards, stars, top } = s.awards;
  const chips = ids => ids.map(id => {
    const p = s.players.find(x => x.id === id);
    return `<span class="awardWinner" style="--pc:${p?.color || "#fff"}">${escapeHtml(p?.name || "?")}</span>`;
  }).join("");
  box.innerHTML = `<h3>⭐ Bonus-Sterne</h3>` +
    (awards.length
      ? `<div class="awardGrid">${awards.map(a => `<div class="awardCard${played ? " in" : ""}"><div class="awardIcon">${a.icon}</div><div class="awardTitle">${escapeHtml(a.title)}</div><div class="awardDesc">${escapeHtml(a.desc)}</div><div class="awardWinners">${chips(a.winners)}</div><div class="awardValue">${escapeHtml(a.value)}</div></div>`).join("")}</div>`
      : `<p class="muted">Diesmal gibt es keine Bonus-Sterne.</p>`) +
    `<div class="starTally${played ? " in" : ""}" id="starTally"></div>`;
  const tally = () => {
    const order = [...s.players].sort((a, b) => (stars[b.id] || 0) - (stars[a.id] || 0));
    document.getElementById("starTally").innerHTML = order.map(p =>
      `<div class="tallyRow${top.includes(p.id) ? " top" : ""}" style="--pc:${p.color}"><span class="tallyName">${top.includes(p.id) ? "👑 " : ""}${escapeHtml(p.name)}</span><span class="tallyStars">${"⭐".repeat(stars[p.id] || 0) || "–"}</span></div>`).join("");
    document.getElementById("starTally").classList.add("in");
  };
  const cardsEls = [...box.querySelectorAll(".awardCard")];
  if (played) { tally(); return; }
  const step = 950;
  cardsEls.forEach((el, i) => setTimeout(() => { el.classList.add("in"); sfx.award(); }, 500 + i * step));
  setTimeout(() => { tally(); if (top.length) sfx.stars(); sessionStorage.setItem(seenKey, "1"); }, 500 + cardsEls.length * step + 500);
}
