import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const upstream=readFileSync(new URL('../original/bombit-1.min.js',import.meta.url),'utf8');
const patch=readFileSync(new URL('../public/classic-ai.js',import.meta.url),'utf8');
function fixture(){
 const Game={SETTINGS:{CELL_WIDTH:49,CELL_HEIGHT:49,GRID_WIDTH:11,GRID_HEIGHT:11,SLOW_TIME:600000/35,FROZEN_TIME:300000/35},GAME_STATUS:{PLAYING:0,PAUSED:1,GAME_OVER:2},MAP:{FREE:0,WALL:1,BLOCK:3,BOMB:4},DIRECTION:{LEFT:4,UP:1,RIGHT:5,DOWN:8}};
 const context=vm.createContext({Game,Phaser:{Group:function(){}},__extends(child,parent){child.prototype=Object.create(parent.prototype);child.prototype.constructor=child;}});
 for(const name of ['Player','PlayerAI']){const marker=`l.${name}=t}`,end=upstream.indexOf(marker),start=upstream.lastIndexOf('function(l){',end);assert.ok(start>=0&&end>start);vm.runInContext(`(${upstream.slice(start,end+marker.length)})(Game)`,context);}
 vm.runInContext(patch,context);
 const cells=Array.from({length:11},(_,x)=>Array.from({length:11},(_,y)=>({gridPositionX:x,gridPositionY:y,centerX:(x+.5)*49,centerY:(y+.5)*49,left:x*49,right:(x+1)*49,top:y*49,bottom:(y+1)*49,isEmpty:true,cellContains:Game.MAP.FREE})));
 const grid={cells,bombs:[],bombExplosions:[],difficulty:1,rowsGroup:cells.map(()=>({add(){}}))};
 const player=Object.assign(Object.create(Game.PlayerAI.prototype),{grid,game:{time:{elapsedMS:1000/35}},gridCell:cells[5][5],gridPositionX:5,gridPositionY:5,x:cells[5][5].centerX,y:cells[5][5].centerY,gameScale:1,gameStatus:0,moving:false,movingAnimation:false,dead:false});
 for(const name of ['checkInitialBlinking','checkItemPickUp','checkOwnBombs','checkDangerZone','checkInvulnerability','checkInvincibility','checkAnimation','checkIndicators'])player[name]=()=>{};
 player.classicThink=()=>{};
 return{Game,player,grid};
}
const vectors=[[-1,0],[0,-1],[1,0],[0,1]];
function positionConsistent(p){
 assert.equal(p.gridPositionX,Math.floor(p.x/49),'logical column must agree with physical position');
 assert.equal(p.gridPositionY,Math.floor(p.y/49),'logical row must agree with physical position');
 assert.equal(p.gridCell,p.grid.cells[p.gridPositionX][p.gridPositionY]);
}
for(const [direction,[dx,dy]]of vectors.entries())test(`slow applied mid-move stays on one corridor and turns at the cell center: direction ${direction}`,()=>{
 const {player:p,grid,Game}=fixture();
 // Surround an L-shaped corridor with solid terrain.
 for(const col of grid.cells)for(const c of col){c.cellContains=Game.MAP.WALL;c.isEmpty=false;}
 const origin=grid.cells[5][5],corner=grid.cells[5+dx][5+dy],turn=grid.cells[5+dx-dy][5+dy+dx];
 for(const c of [origin,corner,turn]){c.cellContains=Game.MAP.FREE;c.isEmpty=true;}
 assert.equal(p.classicBeginMove(direction),true);
 for(let i=0;i<4;i++)p.update();
 p.activateSlowDown();let last={x:p.x,y:p.y},ticks=0;
 while(p.moving&&ticks++<25){p.update();assert.ok((p.x-last.x)*dx+(p.y-last.y)*dy>=-1e-7,'applying slow must not rewind position');assert.ok(Math.abs(p.x-last.x)<1e-7||Math.abs(p.y-last.y)<1e-7,'never move diagonally');positionConsistent(p);last={x:p.x,y:p.y};}
 assert.ok(ticks<25);assert.equal(p.x,corner.centerX);assert.equal(p.y,corner.centerY);
 const turnIndex=vectors.findIndex(([x,y])=>x===-dy&&y===dx);assert.equal(p.classicBeginMove(turnIndex),true);
 for(let i=0;i<20;i++){const x=p.x,y=p.y;p.update();assert.ok(Math.abs(p.x-x)<1e-7||Math.abs(p.y-y)<1e-7);positionConsistent(p);assert.equal(p.gridCell.cellContains,Game.MAP.FREE);}
 assert.equal(p.moving,false);assert.equal(p.x,turn.centerX);assert.equal(p.y,turn.centerY);
});
test('slow expiry accelerates only remaining distance, without jumping across a cell',()=>{
 const{player:p,Game}=fixture();p.activateSlowDown();p.classicBeginMove(2);for(let i=0;i<5;i++)p.update();const before=p.x;
 p.slowTimer=Game.SETTINGS.SLOW_TIME-1000/35;p.update();assert.equal(p.slowed,false);assert.ok(Math.abs(p.x-before-49/6)<1e-7);positionConsistent(p);
});
test('reapplying slow preserves progress; normal/slow moves take exactly 6/20 AI ticks',()=>{
 for(const slowed of [false,true]){const{player:p}=fixture();if(slowed)p.activateSlowDown();p.classicBeginMove(0);let ticks=0;while(p.moving&&ticks<25){if(slowed&&ticks===10)p.activateSlowDown();p.update();ticks++;}assert.equal(ticks,slowed?20:6);}
});
test('a speed pickup mid-move changes only subsequent movement',()=>{
 const{player:p}=fixture();p.classicBeginMove(2);p.update();p.update();const x=p.x;
 p.classicMoveFrames=3;p.update();assert.ok(Math.abs(p.x-x-49/3)<1e-7);positionConsistent(p);
 p.update();assert.equal(p.moving,false);assert.equal(p.x,p.grid.cells[6][5].centerX);
});
test('freezing or pausing a bot mid-step preserves its position and remaining movement',()=>{
 const{player:p,Game}=fixture();p.classicBeginMove(2);p.update();const x=p.x;
 p.frozen=true;p.frozenTimer=0;for(let i=0;i<10;i++)p.update();assert.equal(p.x,x);p.frozen=false;
 p.gameStatus=Game.GAME_STATUS.PAUSED;for(let i=0;i<10;i++)p.update();assert.equal(p.x,x);
 p.gameStatus=Game.GAME_STATUS.PLAYING;p.update();assert.ok(Math.abs(p.x-x-49/6)<1e-7);
});
