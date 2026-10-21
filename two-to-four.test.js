'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),EventEmitter=require('node:events');
class MockWSS extends EventEmitter{constructor(){super();this.clients=new Set()}close(){}}
const orig=Module._load;Module._load=function(id,...args){if(id==='ws')return {WebSocketServer:MockWSS,WebSocket:{OPEN:1}};return orig.call(this,id,...args)};
const g=require('../server.js');Module._load=orig;
const ws=()=>({readyState:1,send(){}});
for(const count of [2,3,4])test(`room with ${count} players can start, survive combat update, and pass shop`,()=>{
 const r=g.newRoom();for(let i=0;i<count;i++){r.players[i]=g.player(i,String(i));r.players[i].ws=ws()}
 assert.equal(g.canStart(r),true);g.participants(r).forEach(g.applyProfile);g.beginWave(r);
 r.stage=4;r.stageTimer=100;r.enemies=[];g.update(r,1/30);assert.equal(r.phase,'shop');
 for(const p of g.participants(r))r.ready[p.id]=true;
 assert.equal(g.participants(r).every(q=>r.ready[q.id]),true);
 g.beginWave(r);assert.equal(r.phase,'combat');g.update(r,1/30);assert.equal(r.phase,'combat');g.rooms.delete(r.code);
});
test('room with one player or disconnected teammate cannot start',()=>{
 const r=g.newRoom();r.players[0]=g.player(0,'host');r.players[0].ws=ws();assert.equal(g.canStart(r),false);
 r.players[1]=g.player(1,'guest');r.players[1].ws=ws();assert.equal(g.canStart(r),true);
 r.players[1].ws=null;assert.equal(g.canStart(r),false);g.rooms.delete(r.code);
});
test.after(()=>g.stop());
