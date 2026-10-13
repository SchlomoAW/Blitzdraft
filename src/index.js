import { DurableObject } from "cloudflare:workers";

const API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const SETS_API = "https://db.ygoprodeck.com/api/v7/cardsets.php";
const ARCHETYPES_API = "https://db.ygoprodeck.com/api/v7/archetypes.php";
const IMAGE = "https://images.ygoprodeck.com/images/cards_small/";
const COLORS = ["#e53935", "#1e88e5", "#43a047", "#8e24aa", "#fb8c00", "#00897b", "#6d4c41", "#3949ab"];
const ROUND_PAUSE_MS = 2000;
const COUNTDOWN_MS = 2000;
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ENDED_ROOM_TTL_MS = 10 * 60 * 1000;
const LOBBY_TTL_MS = 24 * 60 * 60 * 1000;
const IDLE_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const POWERUP_TYPES = ["wall", "blitz", "explosion", "star"];
const WALL_MS = 4000;
const STAR_MS = 10000;
const POWERUP_META = { wall:{name:"Mauer",icon:"🧱"}, blitz:{name:"Blitz",icon:"⚡"}, explosion:{name:"Bombe",icon:"💥"}, star:{name:"Stern",icon:"⭐"} };

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
function roomDefaults(){return {id:"",creator:null,players:[],maxPlayers:4,rows:2,cols:4,picksPerRound:1,target:40,allowUndo:false,powerupsEnabled:false,powerupItems:[],nextPowerupAt:null,activeEffects:[],cursors:{},pool:"goat",customCube:[],round:0,phase:"lobby",roundCards:[],roundStartedAt:null,roundPicks:{},createdAt:Date.now(),lastActivityAt:Date.now()}}

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
  const {holder}=takeFromDeck(s,card);
  if(holder&&!card.extra)s.roundPicks[holder.id]=Math.max(0,(s.roundPicks[holder.id]||0)-1);
  card.pickedBy=null;card.extra=false;card.destroyed=kind;
  (s.destroyedUids||(s.destroyedUids=[])).push(card.uid);
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
async function resolveCube(cubeId,customCube=[]){
  if(cubeId==="custom"){
    const result=[];
    for(const item of Array.isArray(customCube)?customCube:[]){
      const id=String(item.id||"");
      const copies=clampInt(item.copies,1,99,1);
      if(!id)continue;
      const data=await apiGet({id,language:"de"});
      if(data[0])for(let i=0;i<copies;i++)result.push(cardShape(data[0]));
    }
    return result;
  }
  const cube=CUBES[cubeId]||CUBES.goat;
  if(cube.mode==="names"){
    const result=[];for(const [name,copies] of cube.names){const data=await apiGet({name,language:"de"});if(data[0])for(let i=0;i<copies;i++)result.push(cardShape(data[0]))}return result;
  }
  return (await apiGet(cube.params)).map(cardShape);
}
function scheduleRound(ctx,phase){
  const now=Date.now();
  if(phase==="pause") return ctx.storage.setAlarm(now+ROUND_PAUSE_MS);
  if(phase==="countdown") return ctx.storage.setAlarm(now+COUNTDOWN_MS);
}
function publicState(s,viewerId=null){
  const players=s.players.map(p=>({id:p.id,name:p.name,color:p.color,total:p.deck.length,roundPicks:s.roundPicks[p.id]||0,target:s.target,ready:!!p.ready}));
  const own=s.players.find(p=>p.id===viewerId);
  const now=Date.now(),effects=(s.activeEffects||[]).filter(e=>e.expiresAt>now);
  const walls=effects.filter(e=>e.type==="wall");
  const cards=s.roundCards.map((c,i)=>{
    if(c.destroyed)return {uid:c.uid,id:c.id,destroyed:c.destroyed,image:c.destroyed==="burnt"?c.image:"",pickedBy:null,pickedByName:null};
    const hidden=walls.some(e=>e.playerId!==viewerId&&lineHas(s,e,i));
    if(hidden)return {uid:c.uid,id:c.id,hidden:true,pickedBy:c.pickedBy,pickedByName:c.pickedBy?(s.players.find(p=>p.id===c.pickedBy)?.name||""):null};
    return {...c,pickedByName:c.pickedBy?(s.players.find(p=>p.id===c.pickedBy)?.name||""):null};
  });
  return {room:{id:s.id,maxPlayers:s.maxPlayers,rows:s.rows,cols:s.cols,picksPerRound:s.picksPerRound,target:s.target,allowUndo:!!s.allowUndo,powerupsEnabled:!!s.powerupsEnabled,pool:s.pool,round:s.round,phase:s.phase,endedManually:!!s.endedManually,roundStartedAt:s.roundStartedAt},players,cards,ownDeck:own?own.deck:[],powerup:own?.powerup||null,powerupItems:(s.powerupItems||[]).map(i=>({id:i.id,type:i.type,x:i.x,startedAt:i.startedAt,duration:i.duration})),activeEffects:effects.map(e=>({type:e.type,playerId:e.playerId,expiresAt:e.expiresAt})),blockedUids:s.roundCards.filter((c,i)=>!c.destroyed&&walls.some(e=>e.playerId===viewerId&&lineHas(s,e,i))).map(c=>c.uid),error:null};
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
      if(s.powerupsEnabled) s.nextPowerupAt=Date.now()+2500+Math.floor(Math.random()*2501);
      await this.save(s);
      await this.broadcastState();
      await this.ctx.storage.setAlarm(s.powerupsEnabled ? Math.min(s.nextPowerupAt,Date.now()+60000) : Date.now()+24*60*60*1000);
      return;
    }
    if(s.phase==="draft" && !s.powerupsEnabled){
      await this.ctx.storage.setAlarm(now+24*60*60*1000);
      return;
    }
    if(s.phase==="draft" && s.powerupsEnabled){
      let changed=false;
      const oldEffects=(s.activeEffects||[]).length,oldItems=(s.powerupItems||[]).length;
      s.activeEffects=(s.activeEffects||[]).filter(e=>e.expiresAt>now);
      s.powerupItems=(s.powerupItems||[]).filter(i=>now-i.startedAt<i.duration);
      if(oldEffects!==s.activeEffects.length||oldItems!==s.powerupItems.length)changed=true;
      if(!s.nextPowerupAt || s.nextPowerupAt<=now){
        if(s.powerupItems.length<2){
          const type=POWERUP_TYPES[Math.floor(Math.random()*POWERUP_TYPES.length)];
          s.powerupItems.push({id:crypto.randomUUID(),type,x:0.08+Math.random()*0.84,startedAt:now,duration:12000});
          changed=true;
        }
        s.nextPowerupAt=now+8000+Math.floor(Math.random()*5001);
      }
      await this.save(s);
      if(changed) await this.broadcastState();
      // Items animate locally. Wake only when the next spawn, item expiry, or effect expiry occurs.
      const deadlines=[s.nextPowerupAt,...s.powerupItems.map(i=>i.startedAt+i.duration),...s.activeEffects.map(e=>e.expiresAt)]
        .filter(t=>Number.isFinite(t)&&t>now);
      const next=deadlines.length?Math.min(...deadlines):now+15000;
      await this.ctx.storage.setAlarm(Math.max(now+1000,next));
      return;
    }
  }
  async webSocketMessage(ws,message){
    let msg;try{msg=JSON.parse(message)}catch{return}
    let s=await this.load();
    if(msg.type==="create"){
      if(s.id)return this.send(ws,{type:"error",message:"Raum existiert bereits."});
      const hostId=crypto.randomUUID();s={...roomDefaults(),id:String(msg.room||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8)||Math.random().toString(36).slice(2,8).toUpperCase(),creator:hostId,players:[{id:hostId,name:cleanName(msg.name,"Host"),color:COLORS[0],deck:[],ready:false}],maxPlayers:clampInt(msg.maxPlayers,2,8,4),rows:clampInt(msg.rows,1,6,2),cols:clampInt(msg.cols,1,10,4),picksPerRound:clampInt(msg.picksPerRound,1,10,1),target:clampInt(msg.target,1,60,40),allowUndo:!!msg.allowUndo,powerupsEnabled:!!msg.powerupsEnabled,nextPowerupAt:Date.now()+10000+Math.floor(Math.random()*5001),pool:msg.pool==="custom"?"custom":(CUBES[msg.pool]?msg.pool:"goat"),customCube:Array.isArray(msg.customCube)?msg.customCube.slice(0,500):[]};
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
      s.nextPowerupAt=null;
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
        const pool=materialize(await resolveCube(s.pool,s.customCube));const needed=s.rows*s.cols;
        if(pool.length<needed)return this.send(ws,{type:"error",message:`Cube liefert nur ${pool.length} eindeutige Karten, benötigt werden ${needed}.`});
        s.lastActivityAt=Date.now();s.round=1;s.roundCards=shuffle(pool).slice(0,needed);s.roundPicks=Object.fromEntries(s.players.map(p=>[p.id,0]));s.phase="pause";s.roundStartedAt=Date.now()+ROUND_PAUSE_MS;await this.save(s);await this.broadcastState();await scheduleRound(this.ctx,"pause");
      }catch(e){this.send(ws,{type:"error",message:`Karten konnten nicht geladen werden: ${e.message}`})}return;
    }
    if(msg.type==="collectPowerup"){
      if(!s.powerupsEnabled||s.phase!=="draft")return;
      const player=s.players.find(p=>p.id===playerId);
      if(!player||player.powerup)return;
      const item=(s.powerupItems||[]).find(i=>i.id===String(msg.itemId));
      if(!item)return;
      const now=Date.now();
      if(now-item.startedAt>=item.duration)return;
      const x=Math.max(0,Math.min(1,Number(msg.x)||0));
      const y=Math.max(0,Math.min(1,Number(msg.y)||0));
      const itemY=Math.min(1.08,Math.max(-.08,(now-item.startedAt)/item.duration*1.16-.08));
      if(Math.hypot(x-item.x,y-itemY)>.14)return;
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
      let fxPayload=null,wakeAt=null;
      if(type==="wall"){
        // zufaellig 1 Reihe ODER 1 Spalte (nie das ganze Raster)
        let line=Math.random()<.5?"row":"col";
        if(s.rows<2&&s.cols>1)line="col";else if(s.cols<2&&s.rows>1)line="row";
        const index=Math.floor(Math.random()*(line==="row"?s.rows:s.cols));
        s.activeEffects.push({type:"wall",playerId,expiresAt:now+WALL_MS,line,index});wakeAt=now+WALL_MS;
      }else if(type==="star"){
        s.activeEffects=s.activeEffects.filter(e=>!(e.type==="star"&&e.playerId===playerId));
        s.activeEffects.push({type:"star",playerId,expiresAt:now+STAR_MS});wakeAt=now+STAR_MS;
      }else if(type==="blitz"){
        // 2-4 zufaellige Karten werden zerstoert (verkohlt); gewaehlte Picks verfallen
        const want=2+Math.floor(Math.random()*3),hit=[];
        for(const c of shuffle(s.roundCards.filter(c=>!c.destroyed))){if(hit.length>=want||slackOf(s)<1)break;destroyCard(s,c,"burnt");hit.push(c.uid)}
        if(!hit.length)return notice("Zu wenige Karten übrig – der Blitz bleibt gespeichert.");
        fxPayload={effect:"blitz",uids:hit};
      }else if(type==="explosion"){
        const card=s.roundCards.find(c=>(c.uid||c.id)===String(msg.cardId||""));
        if(!card||card.destroyed)return notice("Fahre mit der Maus über eine Karte und drücke dann Space.");
        if(hiddenFor(s,s.roundCards.indexOf(card),playerId,now))return notice("Diese Karte ist verdeckt.");
        if(slackOf(s)<1)return notice("Zu wenige Karten übrig, um noch eine zu zerstören.");
        destroyCard(s,card,"gone");fxPayload={effect:"explosion",uid:card.uid};
      }else return;
      player.powerup=null;s.lastActivityAt=now;
      await this.save(s);
      // Alarm rechtzeitig zum Effekt-Ende, damit verdeckte Karten sofort wieder sichtbar werden
      if(wakeAt){const cur=await this.ctx.storage.getAlarm();if(!cur||cur>wakeAt)await this.ctx.storage.setAlarm(wakeAt)}
      if(fxPayload)for(const sock of this.sockets())this.send(sock,{type:"powerup_effect",playerId,...fxPayload});
      await this.broadcastState();return;
    }
    if(msg.type==="steal"){
      if(!s.powerupsEnabled||s.phase!=="draft")return;
      const now=Date.now(),notice=text=>this.send(ws,{type:"powerup_notice",message:text});
      const eff=(s.activeEffects||[]).find(e=>e.type==="star"&&e.playerId===playerId&&e.expiresAt>now);
      if(!eff)return notice("Dein Stern ist nicht mehr aktiv.");
      const thief=s.players.find(p=>p.id===playerId);
      if(thief.deck.length>=s.target)return notice("Dein Deck ist bereits voll.");
      const idx=s.roundCards.findIndex(c=>(c.uid||c.id)===String(msg.cardId)),card=s.roundCards[idx];
      if(!card||card.destroyed||!card.pickedBy||card.pickedBy===playerId)return notice("Du kannst nur Karten klauen, die ein anderer Spieler bereits gepickt hat.");
      if(hiddenFor(s,idx,playerId,now))return notice("Diese Karte ist verdeckt.");
      if(!card.extra&&slackOf(s)<1)return notice("Zu wenige Karten übrig – der Besitzer könnte nicht neu wählen.");
      const {holder,dc}=takeFromDeck(s,card);if(!holder||!dc)return;
      if(!card.extra)s.roundPicks[holder.id]=Math.max(0,(s.roundPicks[holder.id]||0)-1);
      thief.deck.push({...dc,pickedBy:null});card.pickedBy=playerId;card.extra=true;
      s.activeEffects=s.activeEffects.filter(e=>e!==eff);s.lastActivityAt=now;
      await this.save(s);
      for(const sock of this.sockets())this.send(sock,{type:"powerup_effect",effect:"steal",uid:card.uid,playerId,victimId:holder.id});
      await this.broadcastState();return;
    }
    if(msg.type==="undoPick"){
      if(!s.allowUndo||s.phase!=="draft")return;
      const everyoneDone=s.players.every(x=>(s.roundPicks[x.id]||0)>=s.picksPerRound||x.deck.length>=s.target);if(everyoneDone)return this.send(ws,{type:"error",message:"Die Runde ist bereits vollständig abgeschlossen."});
      const p=s.players.find(x=>x.id===playerId);if(!p)return;
      const idx=p.deck.findIndex(c=>(c.uid||c.id)===String(msg.cardId));if(idx<0)return;
      const deckCard=p.deck[idx];s.lastActivityAt=Date.now();p.deck.splice(idx,1);const card=s.roundCards.find(c=>(c.uid||c.id)===String(msg.cardId));const wasExtra=!!card?.extra;if(card){card.pickedBy=null;card.extra=false}if(!wasExtra)s.roundPicks[playerId]=Math.max(0,(s.roundPicks[playerId]||0)-1);await this.save(s);await this.broadcastState();return;
    }
    if(msg.type==="pick"){
      if(s.phase!=="draft")return;
      const p=s.players.find(p=>p.id===playerId);if(!p||p.deck.length>=s.target)return;
      const roundCount=s.roundPicks[playerId]||0;if(roundCount>=s.picksPerRound)return;
      const cardIndex=s.roundCards.findIndex(c=>(c.uid||c.id)===String(msg.cardId));const card=s.roundCards[cardIndex];if(!card)return this.send(ws,{type:"pick_error",cardId:msg.cardId,reason:"not_found"});if(card.destroyed)return this.send(ws,{type:"pick_error",cardId:msg.cardId,reason:"destroyed"});if(hiddenFor(s,cardIndex,playerId))return this.send(ws,{type:"pick_error",cardId:msg.cardId,reason:"hidden"});if(card.pickedBy)return this.send(ws,{type:"pick_error",cardId:msg.cardId,reason:"already_picked"});
      s.lastActivityAt=Date.now();card.pickedBy=playerId;p.deck.push({...card,pickedBy:null});s.roundPicks[playerId]=roundCount+1;
      const finishedRound=s.players.every(x=>(s.roundPicks[x.id]||0)>=s.picksPerRound||x.deck.length>=s.target),finishedDecks=s.players.every(x=>x.deck.length>=s.target);
      if(finishedDecks){s.phase="finished";s.roundStartedAt=null}
      else if(finishedRound){
        s.powerupItems=[];s.activeEffects=[];
        const pool=materialize(await resolveCube(s.pool,s.customCube));const used=new Set(s.players.flatMap(x=>x.deck.map(c=>c.uid)));const dead=new Set(s.destroyedUids||[]);const candidates=shuffle(pool.filter(c=>!used.has(c.uid)&&!dead.has(c.uid))),needed=s.rows*s.cols;
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
  if(url.pathname==="/api/cubes")return json([...Object.values(CUBES).map(c=>({id:c.id,name:c.name,source:c.source})),{id:"custom",name:"Eigener Cube",source:"Selbst zusammengestellt"}]);
  if(url.pathname==="/api/cards/search"){
    const q=(url.searchParams.get("q")||"").trim().slice(0,80);
    const cardId=(url.searchParams.get("id")||"").trim();
    const category=url.searchParams.get("category")||"";
    const monsterType=url.searchParams.get("monstertype")||"";
    const attribute=url.searchParams.get("attribute")||"";
    const race=url.searchParams.get("race")||"";
    const level=url.searchParams.get("level")||"";
    const spell=url.searchParams.get("spell")||"";
    const trap=url.searchParams.get("trap")||"";
    const cardset=url.searchParams.get("set")||"";
    const archetype=url.searchParams.get("archetype")||"";
    const limit=clampInt(url.searchParams.get("limit"),1,500,40);
    if(!q && !cardId && !category && !monsterType && !attribute && !race && !level && !spell && !trap && !cardset && !archetype)return json({data:[]});
    try{
      const params={language:"de",misc:"yes"};
      if(cardId) params.id=cardId; else if(q) params.fname=q;
      if(attribute) params.attribute=attribute;
      if(race) params.race=race;
      if(level) params.level=level;
      if(cardset) params.cardset=cardset;
      if(archetype) params.archetype=archetype;
      let data=[];
      try{data=await apiGet(params)}catch(_){ if(q) data=await apiGet({name:q,language:"de",misc:"yes"}); }
      let shaped=data.map(cardShape);
      shaped=shaped.filter(c=>{
        if(category && c.category!==category)return false;
        if(monsterType){if(c.category!=="Monster")return false;const t=c.type.toLowerCase();if(monsterType==="Normal"&&!/normal monster/.test(t))return false;if(monsterType==="Effect"&&!/effect monster/.test(t))return false;if(monsterType!=="Normal"&&monsterType!=="Effect"&&!t.includes(monsterType.toLowerCase()))return false}
        if(spell && c.type!==spell)return false;
        if(trap && c.type!==trap)return false;
        return true;
      });
      const limited=shaped.slice(0,limit).map(c=>({id:c.id,name:c.name,type:c.type,category:c.category,extraType:c.extraType,image:c.image,desc:c.desc,atk:c.atk,def:c.def,level:c.level,linkval:c.linkval,race:c.race,attribute:c.attribute,mdRarity:c.mdRarity,archetype:c.archetype,frameType:c.frameType}));
      return json({data:limited});
    }catch(e){return json({error:`Kartensuche fehlgeschlagen: ${e.message}`},502)}
  }
  if(url.pathname==="/api/cardsets") {
    try {
      const r=await fetch(SETS_API,{headers:{"User-Agent":"BlitzDraft/0.8"}});
      if(!r.ok) throw new Error(`YGOPRODeck API ${r.status}`);
      const data=await r.json();
      return json({data:Array.isArray(data)?data:[]});
    } catch(e) { return json({error:`Sets konnten nicht geladen werden: ${e.message}`},502); }
  }
  if(url.pathname==="/api/archetypes") {
    try {
      const r=await fetch(ARCHETYPES_API,{headers:{"User-Agent":"BlitzDraft/0.8"}});
      if(!r.ok) throw new Error(`YGOPRODeck API ${r.status}`);
      const data=await r.json();
      return json({data:Array.isArray(data)?data:[]});
    } catch(e) { return json({error:`Archetypen konnten nicht geladen werden: ${e.message}`},502); }
  }
  if(url.pathname==="/api/health")return json({ok:true,version:"0.11.3"});
  return env.ASSETS.fetch(request);
}};
