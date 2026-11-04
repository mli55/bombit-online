/* Real native Phaser update path with controlled display timestamps, not onlineBridge.advance. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
const base=(process.env.BASE_URL||'http://localhost:3000').replace(/\/$/,'');
const output=resolve(process.env.QA_OUTPUT_DIR||'.local/single-clock-qa');
const errors=[],results=[];
try{
 for(const hz of [30,60,120,144,240,'120-to-30'])for(const count of [1,10,100]){
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/game/?clock-qa');await page.waitForFunction(()=>window.onlineBridge?.state==='mainMenuState');
  const result=await page.evaluate(({hz,count})=>{
   const game=Game.App.getInstance();game.raf.stop();TweenLite.ticker.sleep();
   Game.Instances.DataManager.getTutorialComplete=()=>true;Game.PlayerAI.prototype.update=Game.Player.prototype.update;
   game.state.start('gameplayState',true,false,Game.GAME_MODE.ARCADE,1,Game.PLAYER_MODE.SINGLE_PLAYER,Game.MAP_THEME.RANDOM,[0],1);
   const oldNow=Date.now;let wall=game.time.time,raf=game.time.now;Date.now=()=>wall;
   const step=(rate=60)=>{wall+=1000/rate;raf+=1000/rate;game.update(raf);};
   try{
    // Complete the native state transition, then measure from actual placement.
    for(let i=0;i<4;i++)step();
    const state=game.state.getCurrentState(),grid=state.grid,p=grid.players[0];
    for(const b of grid.boxes)b.destroy();grid.boxes=[];
    for(const col of grid.cells)for(const c of col){c.cellContains=Game.MAP.FREE;c.isEmpty=true;c.isDangerCell=c.isFreezeCell=c.isItemCell=false;}
    for(const p of grid.players){p.invincible=true;p.invincibilityTimer=-1e8;}p.bombs=200;p.power=1;
    const start=wall,matchStart=state.gameTimer;let first=null,last=null,ended=null;
    for(let i=0;i<count;i++){
     const c=grid.cells[i%15][Math.floor(i/15)];p.gridCell=c;p.gridPositionX=c.gridPositionX;p.gridPositionY=c.gridPositionY;p.x=c.centerX;p.y=c.centerY;p.putBomb();
     const b=grid.bombs.at(-1),explode=b.explode,end=b.bombExplosion.endExplosion;
     b.explode=function(){first??=wall-start;last=wall-start;return explode.call(this);};
     b.bombExplosion.endExplosion=function(){ended=wall-start;return end.call(this);};
    }
    while((ended===null||grid.bombs.length)&&wall-start<8000)step(hz==='120-to-30'?(wall-start<800?120:30):hz);
    const fuse={first,last,ended,matchMS:state.gameTimer-matchStart,wallMS:wall-start};
    // Pause via the actual native UI action; placed bombs and the match freeze.
    p.gridCell=grid.cells[6][5];p.gridPositionX=6;p.gridPositionY=5;p.x=p.gridCell.centerX;p.y=p.gridCell.centerY;p.putBomb();
    const bomb=grid.bombs[0];step();state.pausePressed();const before={bomb:bomb.timer,match:state.gameTimer};
    for(let i=0;i<120;i++)step(120);
    const pause={bomb:bomb.timer===before.bomb,match:state.gameTimer===before.match};state.pausePressed();step();pause.resumed=bomb.timer>before.bomb;
    return {hz,count,fuse,pause,lives:grid.players.map(p=>p.lives)};
   }finally{Date.now=oldNow;}
  },{hz,count});
  assert.ok(Math.abs(result.fuse.first-60000/35)<55,JSON.stringify(result));
  assert.ok(result.fuse.last-result.fuse.first<1,JSON.stringify(result));
  assert.ok(Math.abs((result.fuse.ended-result.fuse.first)-11000/35)<55,JSON.stringify(result));
  assert.ok(Math.abs(result.fuse.matchMS-result.fuse.wallMS)<55,JSON.stringify(result));
  assert.deepEqual(result.pause,{bomb:true,match:true,resumed:true});
  assert.deepEqual(result.lives,[1,1,1,1]);
  results.push(result);await page.close();
 }
 assert.deepEqual(errors,[]);await mkdir(output,{recursive:true});await writeFile(resolve(output,'results.json'),JSON.stringify({baseURL:base,results},null,2)+'\n');
 console.log(JSON.stringify({baseURL:base,passed:results.length,results},null,2));
}finally{await browser.close();}
