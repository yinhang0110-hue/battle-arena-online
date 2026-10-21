'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),Module=require('node:module'),{EventEmitter}=require('node:events');
class MockWSS extends EventEmitter{constructor(){super();this.clients=new Set()}close(){}}
const original=Module._load;Module._load=function(id,...args){if(id==='ws')return {WebSocketServer:MockWSS,WebSocket:{OPEN:1}};return original.call(this,id,...args)};
const game=require('../server.js');Module._load=original;
test('chat removes control characters and limits 160 chars',()=>{assert.equal(game.cleanChat('  hello\n world  '),'hello world');assert.equal(game.cleanChat('a'.repeat(999)).length,160);assert.equal(game.cleanChat({}), '')});
test('room chat is private, bounded and rate limited',()=>{const a=game.newRoom(),b=game.newRoom(),gotA=[],gotB=[];const pa=game.player(0,'a'),pb=game.player(0,'b');pa.name='Eason Prime';pa.ws={readyState:1,send:t=>gotA.push(JSON.parse(t))};pb.ws={readyState:1,send:t=>gotB.push(JSON.parse(t))};a.players[0]=pa;b.players[0]=pb;assert.equal(game.roomChat(a,pa,'hello team',1000),true);assert.equal(gotA.length,1);assert.equal(gotB.length,0);assert.equal(gotA[0].message.name,'Eason Prime');assert.equal(game.roomChat(a,pa,'too fast',1500),false);assert.equal(game.roomChat(a,pa,'second',2000),true);for(let i=0;i<60;i++)game.roomChat(a,pa,'message '+i,3000+i*1000);assert.equal(a.chat.length,45)});
test('presence counts only connected player slots across rooms',()=>{const base=game.onlinePlayers();const r=game.newRoom();const p=game.player(0,'a');r.players[0]=p;p.ws={readyState:1};assert.equal(game.onlinePlayers(),base+1);p.ws=null;assert.equal(game.onlinePlayers(),base)});
test.after(()=>{game.stop();game.rooms.clear()});
