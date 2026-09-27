const $ = id => document.getElementById(id);
let ws = null, me = null, latest = null, countdownTimer = null;

function showRoom(){ $("lobby").classList.add("hidden"); $("room").classList.remove("hidden"); }
function err(text){ $("lobbyError").textContent = text || ""; $("roomError").textContent = text || ""; }

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active")); b.classList.add("active");
  $("createForm").classList.toggle("hidden", b.dataset.tab!=="create");
  $("joinForm").classList.toggle("hidden", b.dataset.tab!=="join");
});

function updateHint(){
  const n = (+$("rows").value||1)*(+$("cols").value||1);
  const need = Math.max(1, document.querySelectorAll(".player").length || 2)*(+$("picks").value||1);
  $("configHint").textContent = `Angebot: ${n} Karten. Im laufenden Raum gilt: Kartenangebot ≥ Spieler × Picks (${need}).`;
}
["rows","cols","picks"].forEach(id=>$(id).addEventListener("input",updateHint)); updateHint();

function connect(room, playerData){
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/room/${encodeURIComponent(room)}/ws`);
  ws.onopen=()=>ws.send(JSON.stringify(playerData));
  ws.onmessage=e=>{
    const msg=JSON.parse(e.data);
    if(msg.type==="identity"){ me=msg.playerId; return; }
    if(msg.type==="error"){ err(msg.message); return; }
    if(msg.type==="pick_error"){ const el=document.querySelector(`[data-id="${CSS.escape(String(msg.cardId))}"]`); if(el){el.classList.remove("shake");void el.offsetWidth;el.classList.add("shake")} return; }
    if(msg.type==="state"){ latest=msg.state; render(msg.state); }
  };
  ws.onclose=()=>{ if(!latest?.room?.phase || latest.room.phase!=="finished") $("roomError").textContent="Verbindung getrennt."; };
}

$("createForm").onsubmit=e=>{
  e.preventDefault(); err("");
  const room=($("roomCode").value||"").trim().toUpperCase();
  const rows=+$("rows").value, cols=+$("cols").value, picks=+$("picks").value;
  if(rows*cols < 2*picks){ err("Das Raster ist für mindestens 2 Spieler zu klein."); return; }
  connect(room,{type:"create",name:$("createName").value,room,rows,cols,picksPerRound:picks,target:+$("target").value,pool:$("pool").value});
  showRoom();
};
$("joinForm").onsubmit=e=>{e.preventDefault();err("");connect($("joinCode").value.trim().toUpperCase(),{type:"join",name:$("joinName").value});showRoom();};

$("startBtn").onclick=()=>ws?.send(JSON.stringify({type:"start"}));

function render(s){
  $("roomLabel").textContent=`· ${s.room.id}`;
  $("roundLabel").textContent=s.room.phase==="finished"?"Fertig":`Runde ${s.room.round}`;
  const n=s.room.rows*s.room.cols;
  document.documentElement.style.setProperty("--cols",Math.min(s.room.cols,6));
  $("grid").style.setProperty("--cols",Math.min(s.room.cols,6));
  $("startBtn").classList.toggle("hidden", !(s.players.find(p=>p.id===me)?.id===me && s.room.phase==="lobby"));
  const playerMe=s.players.find(p=>p.id===me);
  $("players").innerHTML=s.players.map(p=>`<div class="player" style="border-left-color:${p.color}">${escapeHtml(p.name)} · ${p.total}/${p.target} · Runde ${p.roundPicks}/${s.room.picksPerRound}</div>`).join("");
  if(!me && s.players.length) me=s.players[0].id;

  const visible=s.cards||[];
  $("grid").innerHTML=visible.map(c=>{
    const picked=!!c.pickedBy;
    const owner=s.players.find(p=>p.id===c.pickedBy);
    return `<article class="card ${picked?"picked":""}" data-id="${escapeAttr(c.id)}" style="${picked&&owner?`border-color:${owner.color}`:""}" title="${escapeAttr(c.name)}">
      <img src="${escapeAttr(c.image)}" alt="${escapeAttr(c.name)}" loading="lazy">
      <div class="name">${escapeHtml(c.name)}</div></article>`;
  }).join("");
  document.querySelectorAll(".card:not(.picked)").forEach(el=>el.onclick=()=>ws?.send(JSON.stringify({type:"pick",cardId:el.dataset.id})));

  $("finished").classList.toggle("hidden",s.room.phase!=="finished");
  const deck=s.ownDeck||[];
  $("deck").innerHTML=deck.map(c=>`<img src="${escapeAttr(c.image)}" title="${escapeAttr(c.name)}" alt="${escapeAttr(c.name)}">`).join("");
  const counts={Monster:0,Spell:0,Trap:0}; deck.forEach(c=>counts[c.category]=(counts[c.category]||0)+1);
  $("mCount").textContent=counts.Monster||0;$("sCount").textContent=counts.Spell||0;$("tCount").textContent=counts.Trap||0;$("donutTotal").textContent=deck.length;
  const total=Math.max(1,deck.length), m=counts.Monster/total*100, sp=counts.Spell/total*100;
  $("donut").style.background=`conic-gradient(#e53935 0 ${m}%,#1e88e5 ${m}% ${m+sp}%,#8e24aa ${m+sp}% 100%)`;

  if(s.room.phase==="countdown") runCountdown(s.room.roundStartedAt);
  else $("countdown").classList.add("hidden");
}

function runCountdown(when){
  clearInterval(countdownTimer);
  $("countdown").classList.remove("hidden");
  const tick=()=>{
    const left=Math.max(0,when-Date.now());
    const n=Math.ceil(left/1000);
    $("countdown").textContent=n>0?n:"GO!";
    if(left<=0){clearInterval(countdownTimer);setTimeout(()=>$("countdown").classList.add("hidden"),220);}
  };
  tick(); countdownTimer=setInterval(tick,80);
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function escapeAttr(s){return escapeHtml(s);}
