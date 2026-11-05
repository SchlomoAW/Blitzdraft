import { DurableObject } from "cloudflare:workers";

const API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const IMAGE = "https://images.ygoprodeck.com/images/cards_small/";
const COLORS = ["#e53935", "#1e88e5", "#43a047", "#8e24aa", "#fb8c00", "#00897b", "#6d4c41", "#3949ab"];
const ROUND_PAUSE_MS = 2000;
const COUNTDOWN_MS = 2000;
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ENDED_ROOM_TTL_MS = 10 * 60 * 1000;
const LOBBY_TTL_MS = 24 * 60 * 60 * 1000;
const IDLE_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const POWERUP_TYPES = ["wall", "blitz", "explosion", "swap", "maze", "ghost"];
const WALL_MS = 10000;
const POWERUP_META = { wall:{name:"Mauer",icon:"🧱"}, blitz:{name:"Blitz",icon:"⚡"}, explosion:{name:"Bombe",icon:"💥"}, swap:{name:"Tausch",icon:"♻️"}, maze:{name:"Labyrinth",icon:"🧩"}, ghost:{name:"Geist",icon:"👻"} };

const CUBES = {
  goat: { id:"goat", name:"Goat Format (API-Pool)", source:"YGOPRODeck format=goat", mode:"api", params:{format:"goat",language:"de"} },
  bp1: { id:"bp1", name:"Battle Pack 1 – Epic Dawn", source:"YGOPRODeck cardset", mode:"set", params:{cardset:"Battle Pack: Epic Dawn",language:"de"} },
  bp2: { id:"bp2", name:"Battle Pack 2 – War of the Giants", source:"YGOPRODeck cardset", mode:"set", params:{cardset:"Battle Pack 2: War of the Giants",language:"de"} },
  bp3: { id:"bp3", name:"Battle Pack 3 – Monster League", source:"YGOPRODeck cardset", mode:"set", params:{cardset:"Battle Pack 3: Monster League",language:"de"} },
  battlecity: { id:"battlecity", name:"Battle City Style", source:"Curated classic-card test cube; card data resolved through YGOPRODeck", mode:"names", names:[
    ["Dark Magician",2],["Dark Magician Girl",1],["Blue-Eyes White Dragon",2],["Red-Eyes Black Dragon",1],["Summoned Skull",2],["Jinzo",1],["Buster Blader",1],["Mystic Box",1],["Change of Heart",1],["Monster Reborn",1],["Dark Hole",1],["Raigeki",1],["Harpie's Feather Duster",1],["Premature Burial",1],["Snatch Steal",1],["Graceful Charity",1],["Pot of Greed",1],["Heavy Storm",1],["Swords of Revealing Light",1],["Mirror Force",1],["Magic Cylinder",1],["Call of the Haunted",1],["Sakuretsu Armor",1],["Dust Tornado",1],["Seven Tools of the Bandit",1],["Trap Hole",1],["Bottomless Trap Hole",1],["Mystical Space Typhoon",2],["Book of Moon",1],["Enemy Controller",1],["Breaker the Magical Warrior",2],["Kycoo the Ghost Destroyer",1],["D.D. Warrior Lady",1],["Exiled Force",1],["Magician of Faith",1],["Sangan",1],["Witch of the Black Forest",1],["Cyber Jar",1],["Morphing Jar",1],["Man-Eater Bug",1],["Injection Fairy Lily",1],["Mobius the Frost Monarch",1],["Zaborg the Thunder Monarch",1],["Thousand-Eyes Restrict",1],["Relinquished",1],["Dark Paladin",1]
  ]}
};

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function roomIdFromUrl(url){const p=url.pathname.split("/").filter(Boolean);return p[1]||""}
function cleanName(v,fallback="Player"){const s=String(v||"").trim().slice(0,24);return s||fallback}
function clampInt(v,min,max,fallback){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):fallback}
function roomDefaults(){return {id:"",creator:null,players:[],maxPlayers:4,rows:2,cols:4,picksPerRound:1,target:40,allowUndo:false,powerupsEnabled:false,powerupItems:[],activeEffects:[],cursors:{},pool:"goat",customCube:[],round:0,phase:"lobby",roundCards:[],roundStartedAt:null,roundPicks:{},createdAt:Date.now(),lastActivityAt:Date.now()}}

// ---- Power-up-Helfer -------------------------------------------------------
function lineHas(s,e,i){return e.line==="row"?Math.floor(i/Math.max(1,s.cols))===e.index:(i%Math.max(1,s.cols))===e.index}
function hiddenFor(s,i,viewerId,now=Date.now()){return (s.activeEffects||[]).some(e=>e.type==="wall"&&e.playerId!==viewerId&&e.expiresAt>now&&lineHas(s,e,i))}
// Wie viele Picks muessen in dieser Runde noch fallen?
function needOutstanding(s){return s.players.reduce((n,p)=>n+Math.max(0,Math.min(s.picksPerRound-(s.roundPicks[p.id]||0),s.target-p.deck.length)),0)}
// Freie (lebende, ungepickte) Karten minus noch offene Picks. Muss >= 0 bleiben, sonst blockiert die Runde.
function slackOf(s){return s.roundCards.filter(c=>!c.destroyed&&!c.pickedBy).length-needOutstanding(s)}
function takeFromDeck(s,card){const holder=s.players.find(p=>p.id===card.pickedBy);if(!holder)return {};const i=holder.deck.findIndex(c=>c.uid===card.uid);if(i<0)return {holder};const [dc]=holder.deck.splice(i,1);return {holder,dc}}
// Karte zerstoeren; ein bereits gewaehlter Pick verfaellt (Spieler muss neu waehlen).
function destroyCard(s,card,kind){
  if(card.ghostPending)s.ghostQueue=(s.ghostQueue||[]).filter(g=>g.card.uid!==card.uid);
  else{const {holder}=takeFromDeck(s,card);if(holder)s.roundPicks[holder.id]=Math.max(0,(s.roundPicks[holder.id]||0)-1)}
  card.pickedBy=null;card.ghost=false;card.ghostPending=false;card.ghostFrom=null;card.destroyed=kind;
  (s.destroyedUids||(s.destroyedUids=[])).push(card.uid);
}
// Geister-Karten, die in der Vorrunde nicht mehr zugestellt werden konnten, kommen zu Rundenbeginn ins Deck des Empfaengers
// und zaehlen dort als Pick (aber nie so, dass jemand gar keinen Pick mehr hat)
function deliverGhosts(s){
  const q=s.ghostQueue||[];s.ghostQueue=[];const out=[],counts={};
  for(const g of q){const to=s.players.find(x=>x.id===g.to);if(!to||to.deck.length>=s.target)continue;
    to.deck.push(g.card);counts[to.id]=(counts[to.id]||0)+1;s.roundPicks[to.id]=Math.min(counts[to.id],Math.max(0,s.picksPerRound-1));out.push(g)}
  return out;
}
// Items zu Rundenbeginn: Spieleranzahl - 1 (mindestens 1), versetzt von oben fallend
function spawnRoundItems(s,now){
  const n=Math.max(1,s.players.length-1);
  let bag=[];const nextType=()=>{if(!bag.length)bag=shuffle(POWERUP_TYPES);return bag.pop()};
  const slots=shuffle(Array.from({length:n},(_,i)=>i));
  return slots.map((slot,i)=>({id:crypto.randomUUID(),type:nextType(),x:Math.min(.92,Math.max(.08,.08+(slot+.5)/n*.84+(Math.random()-.5)*.05)),startedAt:now+400+i*650+Math.floor(Math.random()*300),duration:7000+Math.floor(Math.random()*2000)}));
}
// Verruecktes Labyrinth: Reihe r um dx (rechts +1) und Spalte c um dy (unten +1) verschieben.
// Gepickte Karten bleiben auf ihrem Platz, die uebrigen Karten der Linie ruecken um sie herum (Ränder laufen um).
function shiftGrid(s,r,c,dx,dy){
  const R=s.rows,C=s.cols;let g=s.roundCards.slice();
  const apply=(idxs,shift)=>{const mov=idxs.filter(i=>!g[i].pickedBy),m=mov.length;if(m<2)return;const cards=mov.map(i=>g[i]),next=g.slice();mov.forEach((_,k)=>{next[mov[(k+shift+m)%m]]=cards[k]});g=next};
  apply(Array.from({length:C},(_,j)=>r*C+j),dx);
  apply(Array.from({length:R},(_,i)=>i*C+c),dy);
  if(g.every((x,i)=>x===s.roundCards[i]))return false;
  s.roundCards=g;return true;
}
function cardShape(c){
  const image=c.card_images?.[0]?.image_url_small||(c.id?`${IMAGE}${c.id}.jpg`:"");
  const type=c.type||"";
  let category="Monster"; if(/Spell Card/i.test(type)) category="Spell"; else if(/Trap Card/i.test(type)) category="Trap";
  let extraType=null; if(/Fusion Monster/i.test(type)) extraType="Fusion"; else if(/Synchro Monster/i.test(type)) extraType="Synchro"; else if(/XYZ Monster/i.test(type)) extraType="XYZ"; else if(/Link Monster/i.test(type)) extraType="Link";
  return {id:String(c.id),name:c.name,type,category,extraType,desc:c.desc||"",atk:c.atk??null,def:c.def??null,level:c.level??null,linkval:c.linkval??null,race:c.race||"",attribute:c.attribute||"",image,mdRarity:c.md_rarity||null,archetype:c.archetype||"",frameType:c.frameType||"",pickedBy:null};
}
function shuffle(a){const arr=[...a];for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}return arr}
function materialize(cards){const counts={};return cards.filter(Boolean).map(c=>{const n=counts[c.id]||0;counts[c.id]=n+1;return {...c,uid:`${c.id}-${n}`}})}
async function apiGet(params){
  const u=new URL(API);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{"User-Agent":"BlitzDraft/0.7"}});if(!r.ok)throw new Error(`YGOPRODeck API ${r.status}`);
  const data=await r.json();if(data?.error)throw new Error(data.error);return data.data||[];
}
async function resolveCube(cubeId){
  const cube=CUBES[cubeId]||CUBES.goat;
  if(cube.mode==="names"){
    const result=[];for(const [name,copies] of cube.names){const data=await apiGet({name,language:"de"});if(data[0])for(let i=0;i<copies;i++)result.push(cardShape(data[0]))}return result;
  }
  return (await apiGet(cube.params)).map(cardShape);
}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let i=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k],k)}}));return out}
// YGOPRODeck antwortet bei "nichts gefunden" mit HTTP 400
async function apiTry(params){try{return await apiGet(params)}catch(e){if(/API 400|No card matching/i.test(String(e.message)))return [];throw e}}
const nameKey=n=>String(n).toLowerCase().replace(/[’‘`]/g,"'").replace(/\s+/g," ").trim();
// Eigener Cube aus CSV-Eintraegen [{id?,name?,copies}] -> Kartenliste + nicht gefundene Eintraege
async function resolveCustom(entries){
  const list=(Array.isArray(entries)?entries:[]).slice(0,1500).map(e=>({id:/^\d{1,10}$/.test(String(e?.id??""))?String(e.id):"",name:String(e?.name||"").trim().slice(0,120),copies:clampInt(e?.copies,1,99,1)})).filter(e=>e.id||e.name);
  const byId=new Map(),byName=new Map();
  const ids=[...new Set(list.map(e=>e.id).filter(Boolean))],idBatches=[];
  for(let i=0;i<ids.length;i+=60)idBatches.push(ids.slice(i,i+60));
  (await mapLimit(idBatches,4,b=>apiTry({id:b.join(","),language:"de"}))).flat().forEach(c=>{byId.set(String(c.id),c);for(const im of c.card_images||[])byId.set(String(im.id),c)});
  const names=[...new Set(list.filter(e=>!(e.id&&byId.has(e.id))&&e.name).map(e=>e.name))];
  if(names.length){
    const nb=[];for(let i=0;i<names.length;i+=20)nb.push(names.slice(i,i+20));
    let found=(await mapLimit(nb,4,b=>apiTry({name:b.join("|")}))).flat();
    if(!found.length&&names.length>1)found=(await mapLimit(names,5,n=>apiTry({name:n}))).flat();
    const enIds=[...new Set(found.map(c=>String(c.id)))],idb=[];
    for(let i=0;i<enIds.length;i+=60)idb.push(enIds.slice(i,i+60));
    const de=(await mapLimit(idb,4,b=>apiTry({id:b.join(","),language:"de"}))).flat();
    const deById=new Map(de.map(c=>[String(c.id),c]));
    for(const c of found)byName.set(nameKey(c.name),deById.get(String(c.id))||c);
  }
  const cards=[],missing=[];
  for(const e of list){
    const c=(e.id&&byId.get(e.id))||(e.name&&byName.get(nameKey(e.name)));
    if(!c){missing.push(e.name||e.id);continue}
    const shaped=cardShape(c);for(let i=0;i<e.copies;i++)cards.push(shaped);
  }
  return {cards,missing};
}
// Pool einmal pro Draft laden und in mehreren Schluesseln speichern (2-MB-Limit pro Wert)
const POOL_CHUNK=300;
async function savePool(storage,pool){
  const old=await storage.list({prefix:"pool:"});if(old.size)await storage.delete([...old.keys()]);
  const keys=[];const entries={};
  for(let i=0;i<pool.length;i+=POOL_CHUNK){const k="pool:"+String(i/POOL_CHUNK).padStart(3,"0");entries[k]=pool.slice(i,i+POOL_CHUNK);keys.push(k)}
  for(let i=0;i<keys.length;i+=100){const part={};for(const k of keys.slice(i,i+100))part[k]=entries[k];await storage.put(part)}
}
async function loadPool(storage){const m=await storage.list({prefix:"pool:"});return m.size?[...m.values()].flat():null}
async function getPool(ctx,s){
  const cached=await loadPool(ctx.storage);if(cached)return cached;
  const pool=materialize(s.pool==="custom"?(await resolveCustom(s.customCube)).cards:await resolveCube(s.pool));
  await savePool(ctx.storage,pool);return pool;
}
function scheduleRound(ctx,phase){
  const now=Date.now();
  if(phase==="pause") return ctx.storage.setAlarm(now+ROUND_PAUSE_MS);
  if(phase==="countdown") return ctx.storage.setAlarm(now+COUNTDOWN_MS);
}
function publicState(s,viewerId=null){
  const players=s.players.map(p=>({id:p.id,name:p.name,color:p.color,item:p.powerup||null,ghost:!!p.ghostArmed,total:p.deck.length,roundPicks:s.roundPicks[p.id]||0,target:s.target,ready:!!p.ready}));
  const own=s.players.find(p=>p.id===viewerId);
  const now=Date.now(),effects=(s.activeEffects||[]).filter(e=>e.expiresAt>now);
  const walls=effects.filter(e=>e.type==="wall");
  const cards=s.roundCards.map((c,i)=>{
    // Vor Rundenstart (Pause/Countdown) bekommt kein Client Karteninfos
    if(s.phase==="pause"||s.phase==="countdown")return {uid:"h"+i,id:"h"+i,hidden:true,concealed:true,pickedBy:null,pickedByName:null};
    if(c.destroyed)return {uid:c.uid,id:c.id,destroyed:c.destroyed,image:c.destroyed==="burnt"?c.image:"",pickedBy:null,pickedByName:null};
    const hidden=walls.some(e=>e.playerId!==viewerId&&lineHas(s,e,i));
    if(hidden)return {uid:c.uid,id:c.id,hidden:true,hiddenBy:walls.find(e=>e.playerId!==viewerId&&lineHas(s,e,i))?.playerId||null,pickedBy:c.pickedBy,pickedByName:c.pickedBy?(s.players.find(p=>p.id===c.pickedBy)?.name||""):null};
    return {...c,pickedByName:c.pickedBy?(s.players.find(p=>p.id===c.pickedBy)?.name||""):null};
  });
  return {serverNow:now,room:{id:s.id,maxPlayers:s.maxPlayers,rows:s.rows,cols:s.cols,picksPerRound:s.picksPerRound,target:s.target,allowUndo:!!s.allowUndo,powerupsEnabled:!!s.powerupsEnabled,pool:s.pool,round:s.round,phase:s.phase,endedManually:!!s.endedManually,roundStartedAt:s.roundStartedAt},players,cards,ownDeck:own?own.deck:[],powerup:own?.powerup||null,powerupItems:(s.powerupItems||[]).map(i=>({id:i.id,type:i.type,x:i.x,startedAt:i.startedAt,duration:i.duration})),activeEffects:effects.map(e=>({type:e.type,playerId:e.playerId,expiresAt:e.expiresAt})),blockedUids:s.roundCards.filter((c,i)=>!c.destroyed&&walls.some(e=>e.playerId===viewerId&&lineHas(s,e,i))).map(c=>c.uid),error:null};
}

export class DraftRoomV2 extends DurableObject{
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env}
  load(){return this.ctx.storage.get("state").then(s=>s||roomDefaults())}
  async save(s){await this.ctx.storage.put("state",s)}
  sockets(){return this.ctx.getWebSockets()}
  send(ws,msg){try{ws.send(JSON.stringify(msg))}catch{}}
  async broadcastState(){const s=await this.load();for(const ws of this.sockets()){const a=ws.deserializeAttachment?.()||{};this.send(ws,{type:"state",state:publicState(s,a.playerId||null)})}}
  async fetch(request){
    const url=new URL(request.url);
    // Protected one-time maintenance endpoint; token is a Worker secret.
    if(url.pathname==="/__admin/cleanup"){
      if(request.method!=="POST") return new Response("Method not allowed",{status:405});
      const token=this.env.BLITZDRAFT_ADMIN_TOKEN;
      if(!token || request.headers.get("x-blitzdraft-admin-token")!==token) return new Response("Forbidden",{status:403});
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return json({ok:true,cleared:true});
    }
    if(url.pathname.endsWith("/ws")){
      if(request.method!=="GET"||request.headers.get("Upgrade")?.toLowerCase()!=="websocket")return new Response("WebSocket required",{status:426});
      const pair=new WebSocketPair(),client=pair[0],server=pair[1];this.ctx.acceptWebSocket(server);server.serializeAttachment({playerId:null});
      server.send(JSON.stringify({type:"state",state:publicState(await this.load(),null)}));return new Response(null,{status:101,webSocket:client});
    }
    return new Response("DraftRoom",{status:200});
  }
  async alarm(){
    const s=await this.load();
    const now=Date.now();
    // Inaktive Raeume (kein Pick/Join/Start) werden immer geloescht, in jeder Phase.
    const idleMs=now-(s.lastActivityAt||s.createdAt||0);
    if(!s.id || (s.phase!=="lobby" && idleMs>IDLE_DRAFT_TTL_MS)){
      await this.ctx.storage.deleteAll();
      return;
    }
    // Expired or explicitly ended rooms are deleted by an alarm; no server restart needed.
    if(s.phase==="finished" || s.phase==="ended" || s.phase==="lobby"){
      await this.ctx.storage.deleteAll();
      return;
    }
    if(s.phase==="pause"){
      s.phase="countdown";
      s.roundStartedAt=Date.now()+COUNTDOWN_MS;
      await this.save(s);
      await this.broadcastState();
      await scheduleRound(this.ctx,"countdown");
      return;
    }
    if(s.phase==="countdown"){
      s.phase="draft";
      s.roundStartedAt=Date.now();
      s.powerupItems=s.powerupsEnabled?spawnRoundItems(s,Date.now()):[];
      s.activeEffects=[];
      const delivered=deliverGhosts(s);
      await this.save(s);
      for(const g of delivered)for(const sock of this.sockets())this.send(sock,{type:"powerup_effect",playerId:g.from,item:"ghost",effect:"ghostdrop",to:g.to,uid:g.card.uid,name:g.card.name,image:g.card.image});
      await this.broadcastState();
      await this.ctx.storage.setAlarm(Date.now()+30*60*1000);
      return;
    }
    if(s.phase==="draft"){
      const had=(s.activeEffects||[]).length;
      s.activeEffects=(s.activeEffects||[]).filter(e=>e.expiresAt>now);
      if(had!==s.activeEffects.length){await this.save(s);await this.broadcastState()}
      const next=s.activeEffects.map(e=>e.expiresAt).filter(t=>t>now);
      await this.ctx.storage.setAlarm(next.length?Math.max(now+500,Math.min(...next)):now+30*60*1000);
      return;
    }
  }
  async webSocketMessage(ws,message){
    let msg;try{msg=JSON.parse(message)}catch{return}
    let s=await this.load();
    if(msg.type==="create"){
      if(s.id)return this.send(ws,{type:"error",message:"Raum existiert bereits."});
      const hostId=crypto.randomUUID();s={...roomDefaults(),id:String(msg.room||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8)||Math.random().toString(36).slice(2,8).toUpperCase(),creator:hostId,players:[{id:hostId,name:cleanName(msg.name,"Host"),color:COLORS[0],deck:[],ready:false}],maxPlayers:clampInt(msg.maxPlayers,2,8,4),rows:clampInt(msg.rows,1,6,2),cols:clampInt(msg.cols,1,10,4),picksPerRound:clampInt(msg.picksPerRound,1,10,1),target:clampInt(msg.target,1,60,40),allowUndo:!!msg.allowUndo,powerupsEnabled:!!msg.powerupsEnabled,pool:msg.pool==="custom"?"custom":(CUBES[msg.pool]?msg.pool:"goat"),customCube:Array.isArray(msg.customCube)?msg.customCube.slice(0,1500):[]};
      if(s.pool==="custom"&&!s.customCube.length)return this.send(ws,{type:"error",message:"Kein Cube ausgewählt. Importiere zuerst eine CSV."});
      if(s.rows*s.cols<s.maxPlayers*s.picksPerRound)return this.send(ws,{type:"error",message:`Raster zu klein: ${s.rows*s.cols} Karten für ${s.maxPlayers*s.picksPerRound} mögliche Picks.`});
      s.lastActivityAt=Date.now();await this.save(s);await this.ctx.storage.setAlarm(Date.now()+LOBBY_TTL_MS);ws.serializeAttachment({playerId:hostId});this.send(ws,{type:"identity",playerId:hostId});await this.broadcastState();return;
    }
    const att=ws.deserializeAttachment?.()||{},playerId=att.playerId;
    if(msg.type==="join"){
      if(!s.id)return this.send(ws,{type:"error",message:"Raum nicht gefunden."});if(s.phase!=="lobby")return this.send(ws,{type:"error",message:"Draft läuft bereits."});if(s.players.length>=s.maxPlayers)return this.send(ws,{type:"error",message:`Der Raum ist voll (${s.maxPlayers} Spieler).`});
      const id=crypto.randomUUID();s.players.push({id,name:cleanName(msg.name,`Player ${s.players.length+1}`),color:COLORS[s.players.length%COLORS.length],deck:[],ready:false});s.lastActivityAt=Date.now();await this.save(s);ws.serializeAttachment({playerId:id});this.send(ws,{type:"identity",playerId:id});await this.broadcastState();return;
    }
    if(!playerId||!s.players.some(p=>p.id===playerId))return this.send(ws,{type:"error",message:"Nicht im Raum."});
    if(msg.type==="endRoom"){
      if(playerId!==s.creator)return this.send(ws,{type:"error",message:"Nur der Host kann den Raum beenden."});
      if(s.phase==="finished"||s.phase==="ended")return;
      s.phase="ended";
      s.endedManually=true;
      s.roundStartedAt=null;
      s.roundCards=[];
      s.powerupItems=[];
      s.activeEffects=[];
      await this.save(s);
      await this.broadcastState();
      await this.ctx.storage.setAlarm(Date.now()+ENDED_ROOM_TTL_MS);
      return;
    }
    if(msg.type==="ready"){const p=s.players.find(p=>p.id===playerId);p.ready=!!msg.ready;await this.save(s);await this.broadcastState();return}
    if(msg.type==="start"){
      if(playerId!==s.creator)return this.send(ws,{type:"error",message:"Nur der Host kann starten."});if(s.players.length<2)return this.send(ws,{type:"error",message:"Mindestens 2 Spieler erforderlich."});
      if(s.rows*s.cols<s.players.length*s.picksPerRound)return this.send(ws,{type:"error",message:`Raster zu klein: ${s.rows*s.cols} Karten für ${s.players.length*s.picksPerRound} Picks.`});
      try{
        const resolved=s.pool==="custom"?await resolveCustom(s.customCube):{cards:await resolveCube(s.pool),missing:[]};const pool=materialize(resolved.cards);const needed=s.rows*s.cols;
        if(pool.length<needed)return this.send(ws,{type:"error",message:`Cube liefert nur ${pool.length} Karten${resolved.missing.length?` (nicht gefunden: ${resolved.missing.slice(0,5).join(", ")}${resolved.missing.length>5?" …":""})`:""}, benötigt werden ${needed}.`});
        await savePool(this.ctx.storage,pool);
        s.lastActivityAt=Date.now();s.round=1;s.roundCards=shuffle(pool).slice(0,needed);s.roundPicks=Object.fromEntries(s.players.map(p=>[p.id,0]));s.phase="pause";s.roundStartedAt=Date.now()+ROUND_PAUSE_MS;await this.save(s);await this.broadcastState();await scheduleRound(this.ctx,"pause");
        if(resolved.missing.length)this.send(ws,{type:"info",message:`Hinweis: ${resolved.missing.length} Cube-Einträge wurden nicht gefunden (${resolved.missing.slice(0,4).join(", ")}${resolved.missing.length>4?" …":""}).`});
      }catch(e){this.send(ws,{type:"error",message:`Karten konnten nicht geladen werden: ${e.message}`})}return;
    }
    if(msg.type==="collectPowerup"){
      if(!s.powerupsEnabled||s.phase!=="draft")return;
      const player=s.players.find(p=>p.id===playerId);
      if(!player||player.powerup)return;
      const item=(s.powerupItems||[]).find(i=>i.id===String(msg.itemId));
      if(!item)return;
      const now=Date.now();
      if(now<item.startedAt-150||now-item.startedAt>=item.duration)return;
      const x=Math.max(0,Math.min(1,Number(msg.x)||0));
      const y=Math.max(0,Math.min(1,Number(msg.y)||0));
      const itemY=Math.min(1.08,Math.max(-.08,(now-item.startedAt)/item.duration*1.16-.08));
      if(Math.abs(x-item.x)>.1||Math.abs(y-itemY)>.3)return;
      player.powerup=item.type;
      s.lastActivityAt=now;
      s.powerupItems=s.powerupItems.filter(i=>i.id!==item.id);
      await this.save(s);
      this.send(ws,{type:"powerup_notice",message:`${POWERUP_META[item.type].icon} ${POWERUP_META[item.type].name} eingesammelt! Mit Leertaste aktivieren.`});
      await this.broadcastState();
      return;
    }
    if(msg.type==="cursor"){
      const now=Date.now();
      // Hard server-side rate limit: at most 12 cursor broadcasts per second per player.
      if(att.lastCursorBroadcastAt && now-att.lastCursorBroadcastAt<80)return;
      let x=Math.max(0,Math.min(1,Number(msg.x)||0)),y=Math.max(0,Math.min(1,Number(msg.y)||0));
      const prev=att.cursor;
      ws.serializeAttachment({...att,cursor:{x,y,at:now},lastCursorBroadcastAt:now});
      for(const sock of this.sockets()){const a=sock.deserializeAttachment?.()||{};if(a.playerId&&a.playerId!==playerId)this.send(sock,{type:"cursor",playerId,x,y})}
      return;
    }
    if(msg.type==="activatePowerup"){
      if(!s.powerupsEnabled||s.phase!=="draft")return;
      const player=s.players.find(p=>p.id===playerId);if(!player?.powerup)return;
      const type=player.powerup,now=Date.now();
      const notice=text=>this.send(ws,{type:"powerup_notice",message:text});
      s.activeEffects=(s.activeEffects||[]).filter(e=>e.expiresAt>now);
      const target=()=>{const idx=s.roundCards.findIndex(c=>(c.uid||c.id)===String(msg.cardId||""));return {idx,card:s.roundCards[idx]}};
      let fx=null,wakeAt=null;
      if(type==="wall"){
        // zufaellig 1 Reihe ODER 1 Spalte (nie das ganze Raster)
        let line=Math.random()<.5?"row":"col";
        if(s.rows<2&&s.cols>1)line="col";else if(s.cols<2&&s.rows>1)line="row";
        const index=Math.floor(Math.random()*(line==="row"?s.rows:s.cols));
        s.activeEffects.push({type:"wall",playerId,expiresAt:now+WALL_MS,line,index});wakeAt=now+WALL_MS;
        fx={effect:"wall"};
      }else if(type==="blitz"){
        // 2-4 zufaellige Karten werden zerstoert (verkohlt); gewaehlte Picks verfallen
        const want=2+Math.floor(Math.random()*3),hit=[];
        for(const c of shuffle(s.roundCards.filter(c=>!c.destroyed))){if(hit.length>=want||slackOf(s)<1)break;destroyCard(s,c,"burnt");hit.push(c.uid)}
        if(!hit.length)return notice("Zu wenige Karten übrig – der Blitz bleibt gespeichert.");
        fx={effect:"blitz",uids:hit};
      }else if(type==="explosion"){
        const {idx,card}=target();
        if(!card||card.destroyed)return notice("Fahre mit der Maus über eine Karte und drücke dann Space.");
        if(hiddenFor(s,idx,playerId,now))return notice("Diese Karte ist verdeckt.");
        if(slackOf(s)<1)return notice("Zu wenige Karten übrig, um noch eine zu zerstören.");
        destroyCard(s,card,"gone");fx={effect:"explosion",uid:card.uid};
      }else if(type==="swap"){
        // zwei zufaellige Spieler tauschen je eine zufaellige, bereits gewaehlte Karte
        const owners=s.players.filter(p=>s.roundCards.some(c=>!c.destroyed&&!c.ghostPending&&c.pickedBy===p.id));
        if(owners.length<2)return notice("Tausch braucht mindestens 2 Spieler mit gewählter Karte – er bleibt gespeichert.");
        const [A,B]=shuffle(owners).slice(0,2);
        const pickOf=p=>shuffle(s.roundCards.filter(c=>!c.destroyed&&!c.ghostPending&&c.pickedBy===p.id))[0];
        const ca=pickOf(A),cb=pickOf(B);
        const ia=A.deck.findIndex(c=>c.uid===ca.uid),ib=B.deck.findIndex(c=>c.uid===cb.uid);
        if(ia<0||ib<0)return notice("Tausch fehlgeschlagen.");
        const [da]=A.deck.splice(ia,1),[db]=B.deck.splice(ib,1);
        A.deck.push({...db,pickedBy:null});B.deck.push({...da,pickedBy:null});
        ca.pickedBy=B.id;cb.pickedBy=A.id;ca.ghost=cb.ghost=false;
        fx={effect:"swap",a:ca.uid,b:cb.uid,ownerA:A.id,ownerB:B.id};
      }else if(type==="maze"){
        // Reihe und Spalte der gewaehlten Karte rutschen um 1 Feld, Randkarten kommen auf der anderen Seite wieder rein
        const {idx,card}=target();
        if(!card||card.destroyed==="gone")return notice("Fahre mit der Maus über eine Karte und drücke dann Space.");
        if(hiddenFor(s,idx,playerId,now))return notice("Diese Karte ist verdeckt.");
        if(s.rows<2&&s.cols<2)return notice("Das Raster ist zu klein für das Labyrinth.");
        const r=Math.floor(idx/s.cols),c=idx%s.cols,dx=Math.random()<.5?1:-1,dy=Math.random()<.5?1:-1;
        if(!shiftGrid(s,r,c,dx,dy))return notice("Alle Karten in Reihe und Spalte sind gepickt – es kann sich nichts bewegen. Das Item bleibt gespeichert.");
        fx={effect:"maze",uid:card.uid,row:r,col:c,dx,dy};
      }else if(type==="ghost"){
        // naechster Klick auf eine Karte geht an einen zufaelligen Gegner (kostet den Nutzer keinen Pick)
        if(player.ghostArmed)return notice("Dein Geist ist bereits aktiv.");
        if(!s.players.some(x=>x.id!==playerId&&x.deck.length<s.target))return notice("Kein Gegner kann eine Karte bekommen – der Geist bleibt gespeichert.");
        player.ghostArmed=true;fx={effect:"ghost"};
      }else return;
      player.powerup=null;s.lastActivityAt=now;
      await this.save(s);
      // Alarm rechtzeitig zum Effekt-Ende, damit verdeckte Karten sofort wieder sichtbar werden
      if(wakeAt){const cur=await this.ctx.storage.getAlarm();if(!cur||cur>wakeAt)await this.ctx.storage.setAlarm(wakeAt)}
      for(const sock of this.sockets())this.send(sock,{type:"powerup_effect",playerId,item:type,...fx});
      await this.broadcastState();return;
    }
    if(msg.type==="undoPick"){
      if(!s.allowUndo||s.phase!=="draft")return;
      const everyoneDone=s.players.every(x=>(s.roundPicks[x.id]||0)>=s.picksPerRound||x.deck.length>=s.target);if(everyoneDone)return this.send(ws,{type:"error",message:"Die Runde ist bereits vollständig abgeschlossen."});
      const p=s.players.find(x=>x.id===playerId);if(!p)return;
      const idx=p.deck.findIndex(c=>(c.uid||c.id)===String(msg.cardId));if(idx<0)return;
      if(s.roundCards.find(c=>(c.uid||c.id)===String(msg.cardId))?.ghost)return this.send(ws,{type:"powerup_notice",message:"Eine Geister-Karte kann nicht zurückgenommen werden."});const deckCard=p.deck[idx];s.lastActivityAt=Date.now();p.deck.splice(idx,1);const card=s.roundCards.find(c=>(c.uid||c.id)===String(msg.cardId));if(card)card.pickedBy=null;s.roundPicks[playerId]=Math.max(0,(s.roundPicks[playerId]||0)-1);await this.save(s);await this.broadcastState();return;
    }
    if(msg.type==="pick"){
      if(s.phase!=="draft")return;
      const p=s.players.find(p=>p.id===playerId);if(!p)return;
      const roundCount=s.roundPicks[playerId]||0,canRegular=p.deck.length<s.target&&roundCount<s.picksPerRound;
      if(!canRegular&&!p.ghostArmed)return;
      const cardIndex=s.roundCards.findIndex(c=>(c.uid||c.id)===String(msg.cardId));const card=s.roundCards[cardIndex];if(!card)return this.send(ws,{type:"pick_error",cardId:msg.cardId,reason:"not_found"});if(card.destroyed)return this.send(ws,{type:"pick_error",cardId:msg.cardId,reason:"destroyed"});if(hiddenFor(s,cardIndex,playerId))return this.send(ws,{type:"pick_error",cardId:msg.cardId,reason:"hidden"});if(card.pickedBy)return this.send(ws,{type:"pick_error",cardId:msg.cardId,reason:"already_picked"});
      s.lastActivityAt=Date.now();
      let ghostDone=false;
      if(p.ghostArmed){
        // Geist-Pick: Karte geht an einen Gegner, der eigene Pick-Zaehler bleibt unveraendert
        const open=s.players.filter(x=>x.id!==playerId&&x.deck.length<s.target),withSlot=open.filter(x=>(s.roundPicks[x.id]||0)<s.picksPerRound);
        p.ghostArmed=false;
        if(open.length&&(withSlot.length||slackOf(s)>=1)){
          const immediate=withSlot.length>0,to=shuffle(immediate?withSlot:open)[0];
          const {ghost:_g,ghostFrom:_f,ghostPending:_p,...clean}=card;
          card.pickedBy=to.id;card.ghost=true;card.ghostFrom=playerId;card.ghostPending=!immediate;
          if(immediate){to.deck.push({...clean,pickedBy:null});s.roundPicks[to.id]=(s.roundPicks[to.id]||0)+1}
          else(s.ghostQueue||(s.ghostQueue=[])).push({to:to.id,from:playerId,card:{...clean,pickedBy:null}});
          for(const sock of this.sockets())this.send(sock,{type:"powerup_effect",playerId,item:"ghost",effect:"ghostgift",to:to.id,uid:card.uid,pending:!immediate,name:card.name,image:card.image});
          ghostDone=true;
        }else{
          this.send(ws,{type:"powerup_notice",message:"Kein Gegner kann die Karte bekommen – der Geist verpufft."});
          if(!canRegular){await this.save(s);await this.broadcastState();return}
        }
      }
      if(!ghostDone){card.pickedBy=playerId;p.deck.push({...card,pickedBy:null});s.roundPicks[playerId]=roundCount+1}
      const finishedRound=s.players.every(x=>(s.roundPicks[x.id]||0)>=s.picksPerRound||x.deck.length>=s.target),finishedDecks=s.players.every(x=>x.deck.length>=s.target);
      if(finishedDecks){s.phase="finished";s.roundStartedAt=null}
      else if(finishedRound){
        s.powerupItems=[];s.activeEffects=[];s.players.forEach(x=>{x.ghostArmed=false});
        const pool=await getPool(this.ctx,s);const used=new Set([...s.players.flatMap(x=>x.deck.map(c=>c.uid)),...(s.ghostQueue||[]).map(g=>g.card.uid)]);const dead=new Set(s.destroyedUids||[]);const candidates=shuffle(pool.filter(c=>!used.has(c.uid)&&!dead.has(c.uid))),needed=s.rows*s.cols;
        if(candidates.length<needed){s.phase="finished";s.roundStartedAt=null}else{s.round++;s.roundCards=candidates.slice(0,needed);s.roundPicks=Object.fromEntries(s.players.map(x=>[x.id,0]));s.phase="pause";s.roundStartedAt=Date.now()+ROUND_PAUSE_MS}
      }
      await this.save(s);await this.broadcastState();if(s.phase==="pause")await scheduleRound(this.ctx,"pause");if(s.phase==="finished")await this.ctx.storage.setAlarm(Date.now()+ROOM_TTL_MS);return;
    }
  }
  async webSocketClose(ws,code,reason,wasClean){const a=ws.deserializeAttachment?.()||{};if(a.playerId){for(const sock of this.sockets()){if(sock!==ws)this.send(sock,{type:"cursor_remove",playerId:a.playerId})}}console.log("WebSocket closed",code,reason||"",wasClean)}
  async webSocketError(ws,error){console.error("WebSocket error",error)}
}

export default {async fetch(request,env){
  const url=new URL(request.url);
  // Clean only explicit IDs listed via Cloudflare's Durable Objects API.
  if(url.pathname==="/__admin/cleanup-rooms"){
    if(request.method!=="POST") return new Response("Method not allowed",{status:405});
    const token=env.BLITZDRAFT_ADMIN_TOKEN;
    if(!token || request.headers.get("x-blitzdraft-admin-token")!==token) return new Response("Forbidden",{status:403});
    let body; try { body=await request.json(); } catch { return json({error:"Expected JSON body with ids array"},400); }
    if(!body || !Array.isArray(body.ids) || body.ids.length<1 || body.ids.length>100) return json({error:"ids must contain 1 to 100 Durable Object IDs"},400);
    const results=[];
    for(const rawId of body.ids){
      const id=String(rawId||"");
      if(!/^[0-9a-f]{64}$/i.test(id)){results.push({id,ok:false,error:"Invalid Durable Object ID"});continue;}
      try{
        const stub=env.DRAFT_ROOMS_V2.get(env.DRAFT_ROOMS_V2.idFromString(id));
        const r=await stub.fetch("https://draft-room.internal/__admin/cleanup",{method:"POST",headers:{"x-blitzdraft-admin-token":token}});
        results.push({id,ok:r.ok,status:r.status});
      }catch(e){results.push({id,ok:false,error:String(e?.message||e)});}
    }
    return json({ok:results.every(r=>r.ok),processed:results.length,results});
  }
  if(url.pathname.startsWith("/room/")){const id=roomIdFromUrl(url).toUpperCase();if(!id)return json({error:"Room ID missing"},400);const stub=env.DRAFT_ROOMS_V2.getByName(id);if(url.pathname.endsWith("/ws")){if(request.method!=="GET"||request.headers.get("Upgrade")?.toLowerCase()!=="websocket")return new Response("Expected WebSocket upgrade",{status:426});return stub.fetch(request)}return json({ok:true,room:id})}
  if(url.pathname==="/api/cubes")return json([...Object.values(CUBES).map(c=>({id:c.id,name:c.name,source:c.source})),{id:"custom",name:"Eigener Cube (CSV-Import)",source:"CSV aus YGOPRODeck"}]);
  if(url.pathname==="/api/health")return json({ok:true,version:"0.12.2"});
  return env.ASSETS.fetch(request);
}};
