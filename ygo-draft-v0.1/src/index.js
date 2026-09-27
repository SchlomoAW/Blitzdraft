const COLORS=["#ef4444","#3b82f6","#22c55e","#eab308","#a855f7","#f97316","#06b6d4","#ec4899","#84cc16","#14b8a6","#8b5cf6","#f43f5e"];

export class DraftRoom{
 constructor(state){this.state=state;this.clients=new Map();this.sessions=new Map();this.data=null;this.ready=state.blockConcurrencyWhile(async()=>{this.data=await state.storage.get("room")||null})}
 async fetch(req){await this.ready;if(req.headers.get("Upgrade")!=="websocket")return new Response("WebSocket required",{status:426});const pair=new WebSocketPair(),[client,server]=Object.values(pair),cid=crypto.randomUUID();server.accept();this.clients.set(cid,server);server.onmessage=e=>this.msg(cid,e.data);server.onclose=()=>this.clients.delete(cid);return new Response(null,{status:101,webSocket:client})}
 send(cid,x){const w=this.clients.get(cid);if(w?.readyState===1)w.send(JSON.stringify(x))}
 broadcast(x){const s=JSON.stringify(x);for(const w of this.clients.values())if(w.readyState===1)w.send(s)}
 async msg(cid,raw){let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==="create")return this.create(cid,m);
  if(m.type==="join")return this.join(cid,m);
  if(m.type==="start")return this.start(cid);
  if(m.type==="pick")return this.pick(cid,m.cardId);
 }
 async create(cid,m){if(this.data)return this.send(cid,{type:"error",message:"Raum existiert bereits."});
  const players=Math.max(2,Math.min(12,+m.players||4)),rows=Math.max(1,Math.min(6,+m.rows||2)),cols=Math.max(1,Math.min(8,+m.cols||4)),picks=Math.max(1,+m.picks||1),target=Math.max(1,+m.target||40);
  if(rows*cols<players*picks)return this.send(cid,{type:"error",message:"Zu wenig Karten: Zeilen × Spalten muss mindestens Spieler × Picks sein."});
  this.data={players,rows,cols,picks,target,round:0,phase:"lobby",cards:[],users:[],creator:null,pool:m.pool||"Demo"};
  await this.state.storage.put("room",this.data);return this.join(cid,m);
 }
 async join(cid,m){if(!this.data)return this.send(cid,{type:"error",message:"Raum nicht gefunden."});if(this.data.phase!=="lobby")return this.send(cid,{type:"error",message:"Draft läuft bereits."});if(this.data.users.length>=this.data.players)return this.send(cid,{type:"error",message:"Raum ist voll."});
  const p={id:crypto.randomUUID(),name:String(m.name||"Spieler").slice(0,24),color:COLORS[this.data.users.length],cards:[],roundPicks:0};this.data.users.push(p);if(!this.data.creator)this.data.creator=p.id;this.sessions.set(cid,p.id);
  await this.save();this.send(cid,{type:"joined",me:p,room:this.public()});this.broadcast({type:"state",room:this.public()});
 }
 public(){return structuredClone(this.data)}
 async start(cid){if(this.sessions.get(cid)!==this.data.creator)return;if(this.data.users.length!==this.data.players)return this.send(cid,{type:"error",message:"Es fehlen noch Spieler."});this.nextRound();await this.save();this.broadcast({type:"state",room:this.public()})}
 makeCards(){const names=["Dark Magician","Blue-Eyes White Dragon","Summoned Skull","Sangan","Breaker the Magical Warrior","Magician of Faith","Jinzo","Kuriboh","Mystical Space Typhoon","Book of Moon","Raigeki","Black Hole","Graceful Charity","Change of Heart","Polymerization","Mirror Force","Trap Hole","Solemn Judgment","Heavy Storm","Premature Burial","Nobleman of Crossout","Snatch Steal","Painful Choice","Thousand-Eyes Restrict"];
  const types=["Monster","Monster","Monster","Monster","Monster","Monster","Monster","Monster","Spell","Spell","Spell","Spell","Spell","Spell","Spell","Trap","Trap","Trap","Spell","Spell","Spell","Spell","Spell","Monster"];
  const n=this.data.rows*this.data.cols;return Array.from({length:n},(_,i)=>({id:crypto.randomUUID(),name:names[(this.data.round*n+i)%names.length],type:types[(this.data.round*n+i)%types.length],pickedBy:null}))}
 nextRound(){this.data.round++;this.data.phase="countdown";this.data.cards=this.makeCards();for(const p of this.data.users)p.roundPicks=0}
 async pick(cid,cardId){const pid=this.sessions.get(cid),p=this.data.users.find(x=>x.id===pid),c=this.data.cards.find(x=>x.id===cardId);if(!p||!c)return;if(this.data.phase==="countdown")this.data.phase="draft";if(c.pickedBy)return this.send(cid,{type:"pick_error",cardId});if(p.roundPicks>=this.data.picks)return;if(p.cards.length>=this.data.target)return;c.pickedBy=pid;p.roundPicks++;p.cards.push({...c});const done=this.data.users.every(x=>x.roundPicks>=this.data.picks||x.cards.length>=this.data.target);if(done){if(this.data.users.every(x=>x.cards.length>=this.data.target))this.data.phase="finished";else this.nextRound()}await this.save();this.broadcast({type:"state",room:this.public()})}
 async save(){await this.state.storage.put("room",this.data)}
}
export default{async fetch(req,env){const u=new URL(req.url);if(u.pathname==="/ws"){const room=u.searchParams.get("room");if(!room)return new Response("room missing",{status:400});return env.DRAFT_ROOMS.get(env.DRAFT_ROOMS.idFromName(room.toUpperCase())).fetch(req)}return env.ASSETS.fetch(req)}};
