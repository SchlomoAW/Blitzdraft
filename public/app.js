const $=id=>document.getElementById(id);
const sfx=window.sfx||new Proxy({},{get:()=>()=>{}});
// Serveruhr: alle Zeitpunkte aus dem State (Items, Effekte, Countdown) beziehen sich auf die Serverzeit
let clockOffset=0;const srvNow=()=>Date.now()+clockOffset;
let ws=null,me=null,latest=null,countdownTimer=null,pauseTimer=null,cursorTimer=null,lastCursor={x:0,y:0};
let effectBannerTimer=null;let lastCursorSentAt=0,infoTimer=null;


function err(text){$("lobbyError").textContent=text||"";$("roomError").textContent=text||""}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function escapeAttr(s){return escapeHtml(s)}
function isExtra(c){return !!c.extraType||/^(Fusion|Synchro|XYZ|Link)/i.test(c.type||"")||/\b(Fusion|Synchro|XYZ|Link) Monster/i.test(c.type||"")}
function extraRank(c){const t=(c.extraType||c.type||"").toLowerCase();if(t.includes("fusion"))return 0;if(t.includes("synchro"))return 1;if(t.includes("xyz"))return 2;if(t.includes("link"))return 3;return 9}
function rarityClass(r){return String(r||"").toLowerCase().replace(/[^a-z]/g,"")}
function rarityBadge(c){return c.mdRarity?`<span class="rarityBadge ${rarityClass(c.mdRarity)}">MD ${escapeHtml(c.mdRarity)}</span>`:""}
function cardInfoHtml(c,compact=false){const stats=[c.attribute,c.level?`Level ${c.level}`:"",c.linkval?`Link ${c.linkval}`:"",c.race,c.atk!=null?`ATK ${c.atk}`:"",c.def!=null?`DEF ${c.def}`:""].filter(Boolean).join(" · ");return `<div class="cardInfoPanelInner">${rarityBadge(c)}<strong>${escapeHtml(c.name)}</strong><span class="tooltipType">${escapeHtml(c.type||"")}</span>${c.archetype?`<span class="tooltipStats">Archetyp: ${escapeHtml(c.archetype)}</span>`:""}${stats?`<span class="tooltipStats">${escapeHtml(stats)}</span>`:""}<p>${escapeHtml(c.desc||"Kein Effekttext verfügbar.")}</p></div>`}
function cardTooltip(c){return `<div class="cardTooltip">${cardInfoHtml(c,true)}</div>`}
function sortedDeck(deck){return [...deck].sort((a,b)=>{const ea=isExtra(a),eb=isExtra(b);if(ea!==eb)return ea?1:-1;if(ea){const ra=extraRank(a),rb=extraRank(b);if(ra!==rb)return ra-rb;const la=a.level??-1,lb=b.level??-1;if(lb!==la)return lb-la;const aa=a.atk??-1,ab=b.atk??-1;if(ab!==aa)return ab-aa;return String(a.name||"").localeCompare(String(b.name||""),"de")}const rank={Monster:0,Spell:1,Trap:2};const ra=rank[a.category]??9,rb=rank[b.category]??9;if(ra!==rb)return ra-rb;if(a.category==="Monster"){const la=a.level??-1,lb=b.level??-1;if(lb!==la)return lb-la;const aa=a.atk??-1,ab=b.atk??-1;if(ab!==aa)return ab-aa}return String(a.name||"").localeCompare(String(b.name||""),"de")})}
function splitDeck(deck){return {main:deck.filter(c=>!isExtra(c)),extra:deck.filter(isExtra)}}

function cardLargeImg(c){const small=c.image||"";if(!small)return "";const big=small.replace("/cards_small/","/cards/");return `<img class="hoverImg" src="${escapeAttr(big)}" alt="${escapeAttr(c.name||"")}" onerror="this.onerror=null;this.src='${escapeAttr(small)}'">`}

function showTab(tab){document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===tab));$("createForm").classList.toggle("hidden",tab!=="create");$("joinForm").classList.toggle("hidden",tab!=="join");$("cubeForm").classList.toggle("hidden",tab!=="cube");if(tab==="cube")renderSavedCubes()}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
function updateHint(){const n=(+$('rows').value||1)*(+$('cols').value||1),need=(+$('maxPlayers').value||2)*(+$('picks').value||1);$('configHint').textContent=`Angebot: ${n} Karten. Benötigt werden mindestens ${need} erfolgreiche Picks pro Runde.`}
["rows","cols","picks","maxPlayers"].forEach(id=>$(id).addEventListener("input",updateHint));updateHint();

// ---------- Cube-Import (nur CSV aus YGOPRODeck) ----------
function loadSavedCubes(){try{return JSON.parse(localStorage.getItem("blitzdraft_named_cubes")||"[]").map(x=>({name:String(x.name||""),entries:(x.entries||x.cards||[]).map(c=>({id:c.id?String(c.id):"",name:c.name||"",copies:Math.max(1,Math.min(99,Number(c.copies)||1))})).filter(c=>c.id||c.name)})).filter(x=>x.name&&x.entries.length)}catch{return[]}}
function saveSavedCubes(list){localStorage.setItem("blitzdraft_named_cubes",JSON.stringify(list))}
const cubeTotal=x=>x.entries.reduce((n,c)=>n+c.copies,0);
function refreshCustomPoolSelect(){const saved=loadSavedCubes(),prev=$("customPool").value;$("customPool").innerHTML=saved.length?saved.map(x=>`<option value="${escapeAttr(x.name)}">${escapeHtml(x.name)} (${cubeTotal(x)} Karten)</option>`).join(""):`<option value="">Noch kein Cube importiert</option>`;if(prev&&saved.some(x=>x.name===prev))$("customPool").value=prev;$("customPoolWrap").classList.toggle("hidden",$("pool").value!=="custom")}
function parseCSV(text){
  text=String(text||"").replace(/^\uFEFF/,"");
  const first=text.split(/\r?\n/).find(l=>l.trim())||"";
  const n=ch=>first.split(ch).length-1;
  const delimiter=n("\t")>0&&n("\t")>=n(",")?"\t":(n(";")>n(",")?";":",");
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
    else if(ch===delimiter&&!quoted){row.push(cell.trim());cell=""}
    else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell=""}
    else cell+=ch}
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  return rows}
// Erkennt Spalten (Name / ID / Anzahl) automatisch; versteht auch "3x Name", "Name x3" und reine Namenslisten
function csvToEntries(text){
  const rows=parseCSV(text);if(!rows.length)return [];
  const norm=h=>String(h||"").toLowerCase().replace(/[^a-z0-9äöüß ]/g," ").replace(/\s+/g," ").trim();
  const isId=c=>/^\d{5,10}$/.test(String(c||"").trim());
  const head=rows[0].map(norm);
  const hasHeader=rows.length>1&&!rows[0].some(isId)&&head.some(h=>/\b(name|card|karte|qty|quantity|count|copies|amount|anzahl|menge|id|passcode)\b/.test(h));
  let idIdx=-1,nameIdx=-1,qtyIdx=-1;
  if(hasHeader){
    idIdx=head.findIndex(h=>/passcode/.test(h)||/^(id|card id|konami id|ygoprodeck id|ygo id)$/.test(h));
    nameIdx=head.findIndex(h=>/^(name|card name|cardname|card|karte|kartenname|english name)$/.test(h));
    if(nameIdx<0)nameIdx=head.findIndex(h=>/name/.test(h)&&!/set|archetype|type|race|attribute|rarity/.test(h));
    qtyIdx=head.findIndex(h=>/^(qty|quantity|count|copies|amount|anzahl|menge|card quantity|card count|x)$/.test(h)||/\b(qty|quantity|copies|anzahl|menge)\b/.test(h));
  }
  const merged=new Map();
  const add=(id,name,copies)=>{id=String(id||"").trim();name=String(name||"").trim();if(!isId(id))id="";if(!id&&!name)return;copies=Math.max(1,Math.min(99,Math.floor(Number(copies))||1));const key=id||name.toLowerCase(),e=merged.get(key);if(e)e.copies=Math.min(99,e.copies+copies);else merged.set(key,{id,name,copies})};
  for(const r of (hasHeader?rows.slice(1):rows)){
    let id="",name="",copies=NaN;
    if(hasHeader){id=idIdx>=0?r[idIdx]:"";name=nameIdx>=0?r[nameIdx]:"";if(qtyIdx>=0)copies=Number(String(r[qtyIdx]).replace(/x/i,""))}
    if(!id&&!name){
      const idCell=r.find(isId),nums=r.filter(c=>/^\d{1,2}x?$/i.test(c)&&c!==idCell),texts=r.filter(c=>c&&!/^\d+x?$/i.test(c));
      id=idCell||"";if(!copies)copies=Number(String(nums[0]||"").replace(/x/i,""));
      name=(!idCell&&!nums.length&&texts.length>1)?texts.join(", "):(texts[0]||"");
    }
    let m;
    if(name&&(m=name.match(/^(\d{1,2})\s*[x×]\s*(.+)$/i))){copies=Number(m[1]);name=m[2]}
    else if(name&&(m=name.match(/^(.+?)\s+[x×]\s*(\d{1,2})$/i))){copies=Number(m[2]);name=m[1]}
    add(id,name,copies)
  }
  return [...merged.values()].slice(0,1500)
}
function renderSavedCubes(){const saved=loadSavedCubes();$("savedCubes").innerHTML=saved.length?saved.map(x=>`<div class="savedCubeRow"><b>${escapeHtml(x.name)}</b><span>${x.entries.length} Karten · ${cubeTotal(x)} Exemplare</span><button type="button" class="remove" data-del-cube="${escapeAttr(x.name)}" title="Cube löschen">×</button></div>`).join(""):"<span class=hint>Noch kein Cube importiert.</span>";document.querySelectorAll("[data-del-cube]").forEach(b=>b.onclick=()=>{if(!confirm(`Cube „${b.dataset.delCube}“ löschen?`))return;saveSavedCubes(loadSavedCubes().filter(x=>x.name!==b.dataset.delCube));refreshCustomPoolSelect();renderSavedCubes()})}
$("importCsvInput").onchange=async e=>{const f=e.target.files?.[0];e.target.value="";if(!f)return;try{const entries=csvToEntries(await f.text());if(!entries.length)throw new Error("In der CSV wurden keine Karten gefunden.");const name=($("customCubeName").value.trim()||f.name.replace(/\.[^.]+$/,"")||"Cube").slice(0,40);const list=loadSavedCubes().filter(x=>x.name!==name);list.push({name,entries});saveSavedCubes(list);$("customCubeName").value="";refreshCustomPoolSelect();renderSavedCubes();$("savedNotice").textContent=`„${name}“ importiert: ${entries.length} verschiedene Karten, ${entries.reduce((n,c)=>n+c.copies,0)} Exemplare ✓`}catch(ex){$("savedNotice").textContent=ex.message}};
$("pool").onchange=()=>$("customPoolWrap").classList.toggle("hidden",$("pool").value!=="custom");
refreshCustomPoolSelect();renderSavedCubes();

function showInfo(text){$("roomError").textContent=text;clearTimeout(infoTimer);infoTimer=setTimeout(()=>{if($("roomError").textContent===text)$("roomError").textContent=""},12000)}
function connect(room,playerData){const proto=location.protocol==="https:"?"wss":"ws";ws=new WebSocket(`${proto}://${location.host}/room/${encodeURIComponent(room)}/ws`);ws.onopen=()=>{$("roomError").textContent="";ws.send(JSON.stringify(playerData))};ws.onerror=()=>{$("roomError").textContent="WebSocket-Fehler. Bitte Seite neu laden."};ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.type==="identity"){me=msg.playerId;return}if(msg.type==="error"){err(msg.message);$("startBtn").disabled=false;return}if(msg.type==="info"){showInfo(msg.message);return}if(msg.type==="pick_error"){sfx.error();const el=document.querySelector(`[data-id="${CSS.escape(String(msg.cardId))}"]`);if(el){el.classList.remove("shake");void el.offsetWidth;el.classList.add("shake")}return}if(msg.type==="cursor"){renderRemoteCursor(msg);return}if(msg.type==="powerup_notice"){$("powerupStatus").textContent=msg.message;return}if(msg.type==="powerup_effect"){playPowerupFx(msg);return}if(msg.type==="cursor_remove"){removeRemoteCursor(msg.playerId);return}if(msg.type==="state"){if(msg.state.serverNow)clockOffset=msg.state.serverNow-Date.now();latest=msg.state;render(msg.state)}};ws.onclose=()=>{if(latest?.room?.phase!=="finished")$("roomError").textContent="Verbindung zum Draft-Server getrennt. Bitte Seite neu laden."}}
function sendCursor(e){if(!ws||ws.readyState!==WebSocket.OPEN||!latest||latest.room.phase==="finished"||latest.room.phase==="ended")return;const now=Date.now();if(now-lastCursorSentAt<85)return;const x=e.clientX/Math.max(1,innerWidth),y=e.clientY/Math.max(1,innerHeight);if(Math.abs(x-lastCursor.x)<.004&&Math.abs(y-lastCursor.y)<.004)return;lastCursor={x,y};lastCursorSentAt=now;ws.send(JSON.stringify({type:"cursor",x,y}))}
window.addEventListener("pointermove",e=>{if(!cursorTimer)cursorTimer=setTimeout(()=>{cursorTimer=null;sendCursor(e)},35)});
function renderRemoteCursor(m){if(m.playerId===me)return;let el=document.querySelector(`[data-remote-cursor="${CSS.escape(m.playerId)}"]`);const p=latest?.players?.find(x=>x.id===m.playerId);if(!el){el=document.createElement("div");el.className="remoteCursor";el.dataset.remoteCursor=m.playerId;el.innerHTML='<span class="cursorArrow"></span><b></b><span class="orbit hidden"><span class="orbitIcon"></span></span>';document.body.appendChild(el)}el.style.left=`${m.x*100}vw`;el.style.top=`${m.y*100}vh`;el.style.setProperty("--cursor-color",p?.color||"#fff");const b=el.querySelector("b"),nm=p?.name||"Player";if(b.textContent!==nm)b.textContent=nm;updateCursorItem(el,p)}
function updateCursorItem(el,p){const o=el.querySelector(".orbit"),ic=p?.item?ICONS[p.item]:(p?.ghost?ICONS.ghost:null);if(ic&&latest?.room?.phase==="draft"){const i=o.querySelector(".orbitIcon");if(i.textContent!==ic)i.textContent=ic;o.classList.toggle("armed",!p.item&&!!p.ghost);o.classList.remove("hidden")}else o.classList.add("hidden")}
function removeRemoteCursor(id){document.querySelector(`[data-remote-cursor="${CSS.escape(id)}"]`)?.remove()}

$("createForm").onsubmit=e=>{e.preventDefault();err("");const pool=$('pool').value,rows=+$('rows').value,cols=+$('cols').value,picks=+$('picks').value,maxPlayers=+$('maxPlayers').value;if(rows*cols<maxPlayers*picks){err(`Das Raster ist zu klein: ${rows*cols} Karten für ${maxPlayers*picks} mögliche Picks.`);return}let chosen=null;if(pool==='custom'){const x=loadSavedCubes().find(c=>c.name===$("customPool").value);if(!x){err("Bitte zuerst im Tab „Cube importieren“ eine CSV importieren.");return}if(cubeTotal(x)<rows*cols){err(`Der Cube enthält nur ${cubeTotal(x)} Karten, für dieses Raster werden ${rows*cols} benötigt.`);return}chosen=x.entries}connect(($('roomCode').value||"").trim().toUpperCase(),{type:"create",name:$('createName').value,room:($('roomCode').value||"").trim().toUpperCase(),maxPlayers,rows,cols,picksPerRound:picks,target:+$('target').value,allowUndo:$('allowUndo').checked,powerupsEnabled:$('enablePowerups').checked,pool,customCube:chosen||[]});$("lobby").classList.add("hidden");$("room").classList.remove("hidden")};
$("joinForm").onsubmit=e=>{e.preventDefault();err("");connect($('joinCode').value.trim().toUpperCase(),{type:"join",name:$('joinName').value});$("lobby").classList.add("hidden");$("room").classList.remove("hidden")};$("startBtn").onclick=()=>{ws?.send(JSON.stringify({type:"start"}));$("startBtn").disabled=true;$("roundStatus").textContent="Karten werden geladen…"};


// ---------- Items ----------
const ICONS={wall:"🧱",blitz:"⚡",explosion:"💥",swap:"♻️",maze:"🧩",ghost:"👻"};
const NAMES={wall:"Mauer",blitz:"Blitz",explosion:"Bombe",swap:"Tausch",maze:"Labyrinth",ghost:"Geist"};
const HINTS={wall:"Space: sperrt 1 zufällige Reihe oder Spalte für die Gegner (10 s)",blitz:"Space: zerstört 2–4 zufällige Karten",explosion:"Maus über eine Karte fahren, dann Space: Karte sprengen",swap:"Space: zwei zufällige Spieler tauschen je eine gewählte Karte",maze:"Maus über eine Karte fahren, dann Space: ihre Reihe und Spalte rutschen 1 Feld (gepickte Karten bleiben stehen)",ghost:"Space: dein nächster Klick auf eine Karte geht an einen Gegner (kostet dich keinen Pick)"};
const TARGETED=new Set(["explosion","maze"]);
const colorOf=id=>latest?.players?.find(p=>p.id===id)?.color||"#ffffff";
const nameOf=id=>latest?.players?.find(p=>p.id===id)?.name||"Jemand";
let prevItem=null,lastPhase=null,tickWhen=0,lastTickN=0;
let ptr={x:0,y:0},ptrKnown=false,held={x:0,y:0},heldRaf=0,hoverUid=null,swapHold=null,mazeFlip=null,bannerUntil=0;
window.addEventListener("pointermove",e=>{ptr.x=e.clientX;ptr.y=e.clientY;ptrKnown=true;const t=e.target,card=t.closest?.(".draftCard");if(card&&!card.classList.contains("goneCard"))hoverUid=card.dataset.id;else if(!t.closest?.("#powerupBar"))hoverUid=null},{passive:true});
function setHeldItem(type,armed){
  let el=document.getElementById("heldItem");
  if(!type){if(el)el.classList.add("hidden");return}
  if(!el){el=document.createElement("div");el.id="heldItem";el.className="heldItem hidden";el.innerHTML='<span class="orbit"><span class="orbitIcon"></span></span>';document.body.appendChild(el)}
  const ic=el.querySelector(".orbitIcon");if(ic.textContent!==ICONS[type])ic.textContent=ICONS[type];el.classList.toggle("armed",!!armed);
  if(el.classList.contains("hidden")){el.classList.remove("hidden");if(!ptrKnown){ptr.x=innerWidth/2;ptr.y=innerHeight/2}held.x=ptr.x;held.y=ptr.y}
  if(!heldRaf)heldRaf=requestAnimationFrame(heldLoop)
}
function heldLoop(){const el=document.getElementById("heldItem");if(!el||el.classList.contains("hidden")){heldRaf=0;return}held.x+=(ptr.x-held.x)*.3;held.y+=(ptr.y-held.y)*.3;el.style.transform=`translate(${held.x}px,${held.y}px)`;heldRaf=requestAnimationFrame(heldLoop)}
function renderPowerups(s){
  const enabled=!!s.room.powerupsEnabled&&s.room.phase==="draft",mine=s.powerup||null,meP=s.players.find(p=>p.id===me);
  $("powerupBar").classList.toggle("hidden",!s.room.powerupsEnabled);
  $("powerupSlot").textContent=mine?`Bereit: ${ICONS[mine]} ${NAMES[mine]}`:"Kein Item gesammelt";
  $("activatePowerupBtn").disabled=!enabled||!mine;
  $("activatePowerupBtn").textContent=TARGETED.has(mine)?`${ICONS[mine]} Einsetzen (Maus über Karte)`:"Mit Space einsetzen";
  const armed=!!meP?.ghost;
  $("powerupStatus").textContent=enabled?(armed?"👻 Geist aktiv: dein nächster Klick auf eine Karte geht an einen Gegner":mine?HINTS[mine]:"Fallende Items mit dem Mauszeiger einsammeln"):"";
  if(mine&&!prevItem&&enabled)sfx.collect();prevItem=mine;
  document.body.classList.toggle("ghostArmed",enabled&&armed);
  document.body.style.setProperty("--my-color",meP?.color||"#ffffff");
  document.body.classList.toggle("targeting",enabled&&TARGETED.has(mine));
  setHeldItem(enabled?(mine||(armed?"ghost":null)):null,enabled&&!mine&&armed);
  document.querySelectorAll(".remoteCursor").forEach(el=>updateCursorItem(el,s.players.find(p=>p.id===el.dataset.remoteCursor)));
  const layer=$("powerupLayer");layer.innerHTML="";
  if(!enabled){tickBanner();return}
  const now=srvNow();
  for(const item of s.powerupItems||[]){
    if(now-item.startedAt>=item.duration)continue;
    const el=document.createElement("button");
    el.type="button";el.className=`fallingPowerup ${item.type}`;el.dataset.powerupId=item.id;
    el.style.left=`calc(${item.x*100}vw - 24px)`;
    el.style.animationDuration=`${item.duration}ms`;
    el.style.animationDelay=`${item.startedAt-now}ms`;
    el.textContent=ICONS[item.type]||"✨";el.title=`${NAMES[item.type]||"Item"} — berühren zum Einsammeln`;
    const collect=e=>{e.preventDefault();if(latest?.powerup)return;const x=e.clientX/Math.max(1,innerWidth),y=e.clientY/Math.max(1,innerHeight);if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"collectPowerup",itemId:item.id,x,y}))};
    el.addEventListener("pointerenter",collect);el.addEventListener("click",collect);
    layer.appendChild(el)
  }
  tickBanner();
}
function flashBanner(text,color){const b=$("effectBanner");b.textContent=text;b.style.borderColor=color||"";b.style.boxShadow=color?`0 8px 28px #0009,0 0 22px ${color}99`:"";b.classList.remove("hidden");bannerUntil=Date.now()+2400}
function tickBanner(){const b=$("effectBanner"),now=srvNow();if(Date.now()<bannerUntil)return;const w=(latest?.activeEffects||[]).find(e=>e.type==="wall"&&e.playerId===me&&e.expiresAt>now);if(w){b.textContent=`🧱 Deine Mauer wirkt noch ${Math.ceil((w.expiresAt-now)/1000)} s – markierte Karten sind für die Gegner verdeckt`;b.style.borderColor=colorOf(me);b.style.boxShadow="";b.classList.remove("hidden")}else b.classList.add("hidden")}
setInterval(tickBanner,400);
function fxLayer(){let l=document.getElementById("fxLayer");if(!l){l=document.createElement("div");l.id="fxLayer";document.body.appendChild(l)}return l}
function cardRect(uid){const el=document.querySelector(`[data-id="${CSS.escape(String(uid))}"]`);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,left:r.left,top:r.top}}
function strikeBolt(c,delay,color){const layer=fxLayer(),NS="http://www.w3.org/2000/svg",svg=document.createElementNS(NS,"svg");svg.setAttribute("class","boltFx");svg.style.animationDelay=`${delay}ms`;svg.style.setProperty("--bolt-color",color||"#ffe066");const sx=c.x+(Math.random()*160-80),steps=8,pts=[[sx,-10]];for(let i=1;i<steps;i++)pts.push([sx+(c.x-sx)*i/steps+(Math.random()*46-23),c.y*i/steps]);pts.push([c.x,c.y]);const d=pts.map(q=>q.join(",")).join(" ");svg.innerHTML=`<polyline points="${d}" class="boltGlow"/><polyline points="${d}" class="boltCore"/><circle cx="${c.x}" cy="${c.y}" r="${Math.max(c.w*.28,14)}" class="boltImpact"/>`;layer.appendChild(svg);setTimeout(()=>svg.remove(),delay+950)}
function explodeAt(c,color){const layer=fxLayer(),b=document.createElement("div");b.className="bombFx";b.style.left=`${c.x}px`;b.style.top=`${c.y}px`;b.style.setProperty("--sz",`${Math.max(c.w,60)*2.4}px`);b.style.setProperty("--pc",color||"#ffd9a0");b.innerHTML='<i class="bombRing"></i><i class="bombFire"></i><i class="bombCore"></i>';layer.appendChild(b);document.body.classList.remove("screenShake");void document.body.offsetWidth;document.body.classList.add("screenShake");setTimeout(()=>{b.remove();document.body.classList.remove("screenShake")},800)}
function playSwap(m,col,who){
  const ra=cardRect(m.a),rb=cardRect(m.b),nA=nameOf(m.ownerA),nB=nameOf(m.ownerB),cA=colorOf(m.ownerA),cB=colorOf(m.ownerB);
  flashBanner(`♻️ ${who}: Tausch! ${nA} ↔ ${nB}`,col);
  if(!ra||!rb)return;
  swapHold={uids:new Set([String(m.a),String(m.b)]),until:Date.now()+1500};
  const layer=fxLayer();
  const ghost=(r,color,name,tx,ty,arc)=>{const g=document.createElement("div");g.className="swapGhost";g.style.cssText=`left:${r.left}px;top:${r.top}px;width:${r.w}px;height:${r.h}px;--gc:${color}`;g.innerHTML=`<b>${escapeHtml(name)}</b>`;layer.appendChild(g);const dx=tx-r.x,dy=ty-r.y;g.animate([{transform:"translate(0,0) scale(1) rotate(0deg)",offset:0},{transform:`translate(${dx/2}px,${dy/2+arc}px) scale(1.18) rotate(${arc>0?-10:10}deg)`,offset:.5},{transform:`translate(${dx}px,${dy}px) scale(1) rotate(0deg)`,offset:1}],{duration:1100,easing:"cubic-bezier(.5,0,.3,1)",fill:"forwards"});setTimeout(()=>g.remove(),1300)};
  ghost(ra,cA,nA,rb.x,rb.y,-70);ghost(rb,cB,nB,ra.x,ra.y,70);
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("class","swapLine");
  svg.innerHTML=`<defs><linearGradient id="swg" gradientUnits="userSpaceOnUse" x1="${ra.x}" y1="${ra.y}" x2="${rb.x}" y2="${rb.y}"><stop offset="0" stop-color="${cA}"/><stop offset="1" stop-color="${cB}"/></linearGradient></defs><line x1="${ra.x}" y1="${ra.y}" x2="${rb.x}" y2="${rb.y}" stroke="url(#swg)" stroke-width="5" stroke-dasharray="12 9" stroke-linecap="round"/>`;
  layer.appendChild(svg);setTimeout(()=>svg.remove(),1300);
  const ic=document.createElement("div");ic.className="swapIcon";ic.textContent="♻️";ic.style.left=`${(ra.x+rb.x)/2}px`;ic.style.top=`${(ra.y+rb.y)/2}px`;layer.appendChild(ic);setTimeout(()=>ic.remove(),1300);
  setTimeout(()=>{swapHold=null;if(latest)render(latest)},1550);
}
function playMaze(m,col,who){
  flashBanner(`🧩 ${who}: Labyrinth! Reihe und Spalte rutschen`,col);
  const cards=[...document.querySelectorAll("#grid .draftCard")];
  mazeFlip={prev:new Map(cards.map(el=>[el.dataset.id,el.getBoundingClientRect()])),until:Date.now()+2500,applied:false};
  const C=latest?.room?.cols||1,R=latest?.room?.rows||1,layer=fxLayer();
  const arrow=(el,sym,cls)=>{const r=el.getBoundingClientRect(),a=document.createElement("div");a.className=`mazeArrow ${cls}`;a.style.cssText=`left:${r.left+r.width/2}px;top:${r.top+r.height/2}px;--mc:${col}`;a.textContent=sym;layer.appendChild(a);setTimeout(()=>a.remove(),1200)};
  for(let j=0;j<C;j++){const el=cards[m.row*C+j];if(el)arrow(el,m.dx>0?"➜":"⬅",m.dx>0?"mazeR":"mazeL")}
  for(let i=0;i<R;i++){const el=cards[i*C+m.col];if(el)arrow(el,m.dy>0?"⬇":"⬆",m.dy>0?"mazeD":"mazeU")}
  const t=cardRect(m.uid);if(t){const ring=document.createElement("div");ring.className="mazeTarget";ring.style.cssText=`left:${t.left}px;top:${t.top}px;width:${t.w}px;height:${t.h}px;--mc:${col}`;layer.appendChild(ring);setTimeout(()=>ring.remove(),1200)}
}
// Karten gleiten animiert an ihre neue Position (FLIP)
function applyMazeFlip(){
  if(!mazeFlip||mazeFlip.applied||Date.now()>mazeFlip.until)return;mazeFlip.applied=true;
  document.querySelectorAll("#grid .draftCard").forEach(el=>{const p=mazeFlip.prev.get(el.dataset.id);if(!p)return;const r=el.getBoundingClientRect(),dx=p.left-r.left,dy=p.top-r.top;if(Math.abs(dx)<2&&Math.abs(dy)<2)return;const far=Math.hypot(dx,dy)>Math.max(r.width,r.height)*1.6;el.style.position="relative";el.style.zIndex=far?"6":"5";el.animate([{transform:`translate(${dx}px,${dy}px)`,opacity:far?.3:1},{transform:"translate(0,0)",opacity:1}],{duration:far?1000:850,easing:"cubic-bezier(.25,.9,.25,1)"})})
}
// Geist: grosser, durchsichtiger Geist erscheint beim Empfaenger und laesst die Karte fallen
function ghostDrop(m,col,target){
  const layer=fxLayer(),big=m.to===me;
  const g=document.createElement("div");g.className=big?"ghostBig":"ghostSmall";g.textContent="👻";
  if(!big&&target){g.style.left=`${target.x}px`;g.style.top=`${target.y}px`}
  layer.appendChild(g);setTimeout(()=>g.remove(),big?2600:1700);
  if(big){const f=document.createElement("div");f.className="ghostTint";f.style.setProperty("--gc",col);layer.appendChild(f);setTimeout(()=>f.remove(),2400)}
  if(m.image){
    const t=target||(()=>{const d=$("deck")?.getBoundingClientRect();return d?{x:d.left+d.width/2,y:d.top+60,w:70,h:100}:{x:innerWidth/2,y:innerHeight/2,w:70,h:100}})();
    const c=document.createElement("div");c.className="ghostDropCard";c.style.setProperty("--gc",col);
    const w=big?150:Math.max(t.w||60,50),h=w*1.45;c.style.cssText+=`;width:${w}px;height:${h}px;left:${big?innerWidth/2-w/2:t.x-w/2}px;top:${big?innerHeight*.28:t.y-h/2-120}px`;
    c.innerHTML=`<img src="${escapeAttr(m.image.replace("/cards_small/","/cards/"))}" alt="">`;layer.appendChild(c);
    const dx=(t.x-w/2)-parseFloat(c.style.left),dy=(t.y-h/2)-parseFloat(c.style.top),delay=big?900:200;
    c.animate([{transform:"translate(0,0) scale(1)",opacity:0,offset:0},{transform:"translate(0,0) scale(1)",opacity:.75,offset:.01},{transform:`translate(${dx}px,${dy*0.92}px) scale(${big?1:1})`,opacity:.9,offset:.8},{transform:`translate(${dx}px,${dy}px) scale(${big?.55:1})`,opacity:0,offset:1}],{duration:big?1500:1000,delay,easing:"cubic-bezier(.5,0,1,.6)",fill:"both"});
    setTimeout(()=>c.remove(),delay+1700);
  }
}
function playPowerupFx(m){
  const col=colorOf(m.playerId),who=nameOf(m.playerId);
  if(m.effect==="wall"){sfx.wall();flashBanner(`🧱 ${who}: Mauer! Eine Reihe/Spalte ist 10 s verdeckt`,col);return}
  if(m.effect==="blitz"){sfx.blitz((m.uids||[]).length||1);const f=document.createElement("div");f.className="screenFlash";fxLayer().appendChild(f);setTimeout(()=>f.remove(),500);(m.uids||[]).forEach((uid,i)=>{const c=cardRect(uid);if(c)strikeBolt(c,i*140,col)});flashBanner(`⚡ ${who}: Blitz! ${(m.uids||[]).length} Karten zerstört`,col);return}
  if(m.effect==="explosion"){sfx.explosion();const c=cardRect(m.uid);if(c)explodeAt(c,col);flashBanner(`💥 ${who}: BOOM! Karte gesprengt`,col);return}
  if(m.effect==="swap"){sfx.swap();playSwap(m,col,who);return}
  if(m.effect==="maze"){sfx.maze();playMaze(m,col,who);return}
  if(m.effect==="ghost"){sfx.ghost();flashBanner(`👻 ${who}: Geist! Der nächste Klick geht an einen Gegner`,col);return}
  if(m.effect==="ghostgift"){
    const to=nameOf(m.to),target=cardRect(m.uid);
    if(m.to===me){sfx.ghostBig();flashBanner(`👻 ${who} schickt dir „${m.name||"eine Karte"}“${m.pending?" – kommt nächste Runde":""}!`,col)}
    else{sfx.ghost();flashBanner(`👻 ${who} schenkt ${to} eine Karte`,col)}
    ghostDrop(m,colorOf(m.to),m.pending?null:target);return
  }
  if(m.effect==="ghostdrop"){
    if(m.to===me){sfx.ghostBig();flashBanner(`👻 Geist-Karte von ${who}: „${m.name||"Karte"}“ landet in deinem Deck`,col);ghostDrop(m,col,null)}
    else{sfx.ghost();flashBanner(`👻 ${who}s Geist-Karte landet bei ${nameOf(m.to)}`,col)}
    return
  }
}
function sendActivate(){if(!ws||ws.readyState!==WebSocket.OPEN)return;const m={type:"activatePowerup"};if(TARGETED.has(latest?.powerup)){if(!hoverUid){$("powerupStatus").textContent="Fahre erst mit der Maus über eine Karte.";return}m.cardId=hoverUid}ws.send(JSON.stringify(m))}
$("activatePowerupBtn").onclick=sendActivate;

$("endRoomBtn").onclick=()=>{
  if(!latest||!ws||ws.readyState!==WebSocket.OPEN)return;
  const running=latest.room.phase!=="lobby";
  const prompt=running
    ?"Draft wirklich jetzt beenden? Alle Spieler werden aus der laufenden Runde genommen. Diese Aktion kann nicht rückgängig gemacht werden."
    :"Raum wirklich schließen? Alle verbundenen Spieler verlieren den Zugang zu diesem Raum.";
  if(window.confirm(prompt))ws.send(JSON.stringify({type:"endRoom"}));
};
window.addEventListener("keydown",e=>{if(e.code!=="Space"||e.repeat)return;const tag=document.activeElement?.tagName?.toLowerCase();if(["input","textarea","select","button"].includes(tag))return;if(latest?.room?.powerupsEnabled&&latest?.powerup&&latest?.room?.phase==="draft"){e.preventDefault();sendActivate()}});

function showDraftHover(c){if(!c||latest?.room?.phase!=="draft"){$("draftHoverPanel").innerHTML='<div class="hoverEmpty">Fahre mit der Maus über eine Karte, um Effekt und Kartendaten hier anzuzeigen.</div>';return}$("draftHoverPanel").innerHTML=cardLargeImg(c)+cardInfoHtml(c)}
// Zeigt die Karte unter dem Mauszeiger (z. B. direkt nach Rundenstart, wenn keine Mausbewegung stattfindet)
function refreshHover(){if(!ptrKnown||latest?.room?.phase!=="draft"){showDraftHover(null);return}const el=document.elementFromPoint(ptr.x,ptr.y)?.closest?.(".draftCard"),c=el&&(latest.cards||[]).find(x=>(x.uid||x.id)===el.dataset.id);showDraftHover(c&&!c.hidden&&!c.destroyed?c:null)}
function bindDraftCards(s){document.querySelectorAll(".draftCard").forEach(el=>{const c=(s.cards||[]).find(x=>(x.uid||x.id)===el.dataset.id);el.addEventListener("mouseenter",()=>showDraftHover((c?.hidden||c?.destroyed)?null:c));el.addEventListener("mouseleave",()=>showDraftHover(null));const undo=el.querySelector("[data-undo-pick]");if(undo)undo.onclick=e=>{e.stopPropagation();ws?.send(JSON.stringify({type:"undoPick",cardId:el.dataset.id}))};el.addEventListener("click",()=>{if(el.classList.contains("burntCard")||el.classList.contains("goneCard"))return;if(s.room.phase==="draft"&&!el.classList.contains("picked")&&!el.classList.contains("hiddenCard")){ws?.send(JSON.stringify({type:"pick",cardId:el.dataset.id}));sfx.pick()}else if(!el.classList.contains("picked")&&!el.classList.contains("hiddenCard")){el.classList.remove("shake");void el.offsetWidth;el.classList.add("shake")}})})}
function cardHtml(c,s,faceUp,blocked){
  const id=c.uid||c.id;
  if(c.destroyed==="gone")return `<article class="card draftCard goneCard" data-id="${escapeAttr(id)}"><div class="cardInner"></div></article>`;
  if(c.destroyed==="burnt")return `<article class="card draftCard burntCard revealed" data-id="${escapeAttr(id)}"><div class="cardInner"><div class="cardBack"></div><div class="cardFront">${c.image?`<img src="${escapeAttr(c.image)}" alt="">`:""}<div class="burntMark">⚡</div></div></div></article>`;
  const swapping=!!swapHold&&Date.now()<swapHold.until&&swapHold.uids.has(String(id));
  const picked=!!c.pickedBy&&!swapping,owner=s.players.find(p=>p.id===c.pickedBy);
  const wallColor=c.hidden&&c.hiddenBy?s.players.find(p=>p.id===c.hiddenBy)?.color:"";
  const st=[picked&&owner?`--owner-color:${owner.color}`:"",wallColor?`--wall-color:${wallColor}`:""].filter(Boolean).join(";");
  return `<article class="card draftCard ${c.hidden?'hiddenCard':''} ${picked?'picked':''} ${faceUp?'revealed':''} ${blocked.has(id)?'wallBlocked':''} ${swapping?'swapping':''} ${c.ghost&&picked?'ghostCard':''}" data-id="${escapeAttr(id)}" style="${st}"><div class="cardInner"><div class="cardBack"><span>BLITZ<br>DRAFT</span></div><div class="cardFront">${c.hidden?'<div class="hiddenCardFace">VERDECKT</div>':`<img src="${escapeAttr(c.image)}" alt="${escapeAttr(c.name)}" loading="lazy">`}${picked&&c.ghost?`<div class="ghostMark">👻</div>`:""}${picked?`<div class="pickedBadge" style="background:${owner?.color||'#fff'}">${c.ghost?`👻 ${escapeHtml(owner?.name||'')}${c.ghostPending?" · nächste Runde":""}`:`✓ ${escapeHtml(owner?.name||'')}`}</div>${s.room.allowUndo&&owner?.id===me&&s.room.phase==="draft"&&!c.ghost?`<button type="button" class="undoPick" data-undo-pick title="Pick zurücknehmen">↩</button>`:""}`:""}</div></div></article>`
}
function phaseSounds(s){const ph=s.room.phase,prev=lastPhase;lastPhase=ph;if(!prev||prev===ph)return;if(ph==="draft"&&(prev==="countdown"||prev==="pause"))sfx.roundStart();else if(ph==="pause"&&prev==="draft")sfx.roundEnd();else if(ph==="finished"&&prev!=="finished")sfx.finished()}
function render(s){phaseSounds(s);$("roomLabel").textContent=`· ${s.room.id}`;$("capacityLabel").textContent=`${s.players.length}/${s.room.maxPlayers} Spieler`;$('roundLabel').textContent=s.room.phase==="finished"?"Fertig":`Runde ${s.room.round}`;const cols=Math.min(s.room.cols,10);document.documentElement.style.setProperty("--cols",cols);$("grid").style.setProperty("--cols",cols);$("startBtn").classList.toggle("hidden",!(s.players.find(p=>p.id===me)?.id===me&&s.room.phase==="lobby"));$("endRoomBtn").classList.toggle("hidden",!(s.players.find(p=>p.id===me)?.id===me&&s.room.phase!=="finished"&&s.room.phase!=="ended"));$("players").innerHTML=s.players.map(p=>`<div class="player" style="border-left-color:${p.color}"><span class="playerDot" style="background:${p.color}"></span>${escapeHtml(p.name)}${p.item?` <span class="plItem" style="--pc:${p.color}" title="${escapeAttr(NAMES[p.item]||"")}">${ICONS[p.item]||""}</span>`:""} · ${p.total}/${p.target} · Runde ${p.roundPicks}/${s.room.picksPerRound}</div>`).join("");if(!me&&s.players.length)me=s.players[0].id;const visible=s.cards||[],faceUp=s.room.phase==="draft",blocked=new Set(s.blockedUids||[]);$("grid").classList.toggle("hidden",s.room.phase==="finished"||s.room.phase==="ended");$("grid").innerHTML=visible.map(c=>cardHtml(c,s,faceUp,blocked)).join("");bindDraftCards(s);applyMazeFlip();renderDeck(s.ownDeck||[]);$("finished").classList.toggle("hidden",s.room.phase!=="finished"&&s.room.phase!=="ended");if(s.room.phase!=="finished"&&s.room.phase!=="ended")refreshHover();if(s.room.phase==="ended"){$("finished").querySelector("h2").textContent="Draft vorzeitig beendet";$("finalCount").textContent=`Draft beendet · ${s.ownDeck?.length||0} Karten gesammelt`;}else if(s.room.phase==="finished"){$("finished").querySelector("h2").textContent="Draft beendet 🎉";$("finalCount").textContent=`${s.ownDeck?.length||0} Karten`;}renderPowerups(s);if(s.room.phase==="pause")runPause(s.room.roundStartedAt);else clearTimeout(pauseTimer);if(s.room.phase==="countdown")runCountdown(s.room.roundStartedAt);else{clearInterval(countdownTimer);$("countdown").classList.add("hidden")}$("roundStatus").textContent=s.room.phase==="pause"?"Letzte Picks sichern…":s.room.phase==="countdown"?"Bereit machen…":s.room.phase==="draft"?"JETZT PICKEN!":(s.room.phase==="finished"||s.room.phase==="ended")?"Draft beendet":"Lobby"}
function renderDeck(deck){const counts={Monster:0,Spell:0,Trap:0};deck.filter(c=>!isExtra(c)).forEach(c=>counts[c.category]=(counts[c.category]||0)+1);$("mCount").textContent=counts.Monster||0;$("sCount").textContent=counts.Spell||0;$("tCount").textContent=counts.Trap||0;$("donutTotal").textContent=deck.length;const total=Math.max(1,deck.length),m=counts.Monster/total*100,sp=counts.Spell/total*100;$("donut").style.background=`conic-gradient(#e53935 0 ${m}%,#1e88e5 ${m}% ${m+sp}%,#8e24aa ${m+sp}% 100%)`;const {main,extra}=splitDeck(sortedDeck(deck));$("deck").innerHTML=main.map(c=>`<article class="deckCard"><div class="deckThumb"><img src="${escapeAttr(c.image)}" alt="${escapeAttr(c.name)}">${rarityBadge(c)}</div>${cardTooltip(c)}</article>`).join("");$("extraDeck").innerHTML=extra.map(c=>`<article class="deckCard"><div class="deckThumb"><img src="${escapeAttr(c.image)}" alt="${escapeAttr(c.name)}">${rarityBadge(c)}</div>${cardTooltip(c)}</article>`).join("");$("finalDeck").innerHTML=main.map(c=>`<article class="finalCard"><img src="${escapeAttr(c.image)}" alt="${escapeAttr(c.name)}">${cardTooltip(c)}</article>`).join("");$("finalExtraDeck").innerHTML=extra.map(c=>`<article class="finalCard"><img src="${escapeAttr(c.image)}" alt="${escapeAttr(c.name)}">${cardTooltip(c)}</article>`).join("");$("finalCount").textContent=`${deck.length} Karten`}
function runPause(when){clearInterval(countdownTimer);clearTimeout(pauseTimer);$("countdown").classList.add("hidden");pauseTimer=setTimeout(()=>{},Math.max(20,when-srvNow()))}
function runCountdown(when){clearTimeout(pauseTimer);clearInterval(countdownTimer);$("countdown").classList.remove("hidden");if(tickWhen!==when){tickWhen=when;lastTickN=0}const tick=()=>{const left=Math.max(0,when-srvNow()),n=Math.ceil(left/1000);if(n>0&&n!==lastTickN){lastTickN=n;sfx.tick()}$("countdown").textContent=n>0?n:"";if(left<=0)clearInterval(countdownTimer)};tick();countdownTimer=setInterval(tick,50)}
function bytesToBase64(bytes){let bin="";for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(bin)}function encodeYdkePart(ids){const raw=new Uint8Array(ids.length*4),view=new DataView(raw.buffer);ids.forEach((id,i)=>view.setUint32(i*4,Number(id),true));return bytesToBase64(raw)}function buildYdke(deck){const main=deck.filter(c=>!isExtra(c)).map(c=>Number(c.id)).filter(Number.isFinite);const extra=deck.filter(isExtra).map(c=>Number(c.id)).filter(Number.isFinite);return `ydke://${encodeYdkePart(main)}!${encodeYdkePart(extra)}!!`}
$("exportYdkeBtn")?.addEventListener("click",async()=>{const deck=latest?.ownDeck||[];if(!deck.length)return;const value=buildYdke(deck);try{await navigator.clipboard.writeText(value);$("ydkeNotice").textContent="YDKE-Link kopiert ✓"}catch{$("ydkeNotice").textContent=value}});
