/* AI blocked by bombs: real placement, native clocks and independent online replay. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
const base=(process.env.BASE_URL||'http://localhost:3000').replace(/\/$/,'');
const output=resolve(process.env.QA_OUTPUT_DIR||'.local/ai-blocked-qa');
const errors=[],results=[];
async function open(){
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 if(process.env.QA_AI_SOURCE){const source=await readFile(process.env.QA_AI_SOURCE,'utf8');await page.route('**/classic-ai.js',route=>route.fulfill({contentType:'text/javascript',body:source}));}
 await page.goto(base+'/game/?ai-blocked-qa');await page.waitForFunction(()=>window.onlineBridge?.state==='mainMenuState');return page;
}
const exercise=({mode,hz})=>{
 const game=Game.App.getInstance(),online=mode==='online-two',results=[];
 game.raf.stop();TweenLite.ticker.sleep();Game.Instances.DataManager.getTutorialComplete=()=>true;
 let wall=game.time.time,raf=game.time.now;const oldNow=Date.now;Date.now=()=>wall;
 let fingerprint=2166136261;
 const advance=()=>{if(online){onlineBridge.advance([onlineBridge.frame+1,[0,0,0,0]],true);for(const c of onlineBridge.checksum())fingerprint=Math.imul(fingerprint^c.charCodeAt(0),16777619)>>>0;}else{wall+=1000/hz;raf+=1000/hz;game.update(raf);}};
 const place=(p,c)=>{p.gridCell=c;p.gridPositionX=c.gridPositionX;p.gridPositionY=c.gridPositionY;p.x=c.centerX;p.y=c.centerY;};
 const check=(ok,msg)=>{if(!ok)throw Error(`${mode}/${hz}: ${msg}`);};
 const directions=[[-1,0],[0,-1],[1,0],[0,1]];
 try{
  for(const [index,[dx,dy]]of directions.entries())for(const slowed of[false,true])for(const scenario of['late-block','surrounded','kick']){
   if(online)onlineBridge.start({seed:'ai-blocked',campaignSeed:'ai-blocked',difficulty:1,round:1,scores:[0,0,0,0],players:[{seat:0,character:0},{seat:1,character:1}]});
   else{game.rnd.sow(['ai-blocked']);game.state.start('gameplayState',true,false,Game.GAME_MODE.ARCADE,1,Game.PLAYER_MODE.SINGLE_PLAYER,Game.MAP_THEME.RANDOM,[0],1);for(let i=0;i<4;i++)advance();}
   const state=game.state.getCurrentState(),grid=state.grid,bot=grid.players.find(p=>p.isAI),human=grid.players.find(p=>!p.isAI);
   for(const p of grid.players){p.invincible=true;p.invincibilityTimer=-1e8;if(p.isAI)p.classicThink=()=>{};}
   for(const b of grid.boxes)b.destroy();grid.boxes=[];
   for(const col of grid.cells)for(const c of col){c.cellContains=Game.MAP.WALL;c.isEmpty=false;c.isDangerCell=c.isFreezeCell=c.isItemCell=false;}
   const origin=grid.cells[6][5],target=grid.cells[6+dx][5+dy],beyond=grid.cells[6+2*dx][5+2*dy];
   const open=c=>{c.cellContains=Game.MAP.FREE;c.isEmpty=true;};
   open(origin);open(target);if(scenario==='kick')open(beyond);
   human.bombs=20;
   const put=c=>{open(c);place(human,c);human.putBomb();place(human,grid.cells[0][0]);return grid.bombs.at(-1);};
   place(bot,origin);bot.moving=bot.movingAnimation=false;if(slowed)bot.activateSlowDown();
   let checks=0,diagonal=false,blockedEntry=false,logicalMismatch=false;
   const update=bot.update;bot.update=function(){const x=this.x,y=this.y,c=this.gridCell;update.call(this);checks++;
    diagonal||=Math.abs(this.x-x)>1e-6&&Math.abs(this.y-y)>1e-6;
    const cell=grid.cells[Math.floor(this.x/49)]?.[Math.floor(this.y/49)];
    blockedEntry||=cell!==c&&[Game.MAP.BOMB,Game.MAP.WALL,Game.MAP.BLOCK].includes(cell?.cellContains);
    logicalMismatch||=cell!==this.gridCell;
   };
   if(scenario==='late-block'){
    check(bot.classicBeginMove(index),'start move before blockage');
    while(!bot.classicMoveProgress)advance();
    const bomb=put(target);put(grid.cells[6-dx][5-dy]);
    const x=bot.x,y=bot.y;
    for(let i=0;i<Math.ceil(hz*.5);i++)advance();
    check(bot.x===x&&bot.y===y,'bot crossed new bomb rather than stopping');
    check(!bot.classicBeginMove((index+1)%4),'mid-cell turn must be rejected');
    // Clear the real bomb through its actual explosion path, then check recovery.
    bomb.explode();let n=0;while(bot.moving&&n++<hz)advance();
    check(!bot.moving&&bot.x===target.centerX&&bot.y===target.centerY,'did not resume when route cleared');
   }else if(scenario==='surrounded'){
    for(const[x,y]of directions)put(grid.cells[6+x][5+y]);
    bot.classicThink=Game.PlayerAI.prototype.classicThink;
    for(let i=0;i<Math.ceil(hz*.5);i++)advance();
    check(bot.x===origin.centerX&&bot.y===origin.centerY,'surrounded bot escaped bombs');
   }else{
    const bomb=put(target);bot.canKickBombs=true;
    check(bot.classicBeginMove(index),'valid kick path');
    let n=0;while(bot.moving&&n++<hz)advance();
    check(!bot.moving&&bot.x===target.centerX&&bot.y===target.centerY,'bot did not follow cleared kick');
    check(bomb.isKicked||!bomb.exists,'real bomb must move or detonate');
   }
   check(!diagonal,'diagonal movement');check(!blockedEntry,'entered blocked cell');check(!logicalMismatch,'logical and physical position diverged');
   results.push({direction:index,slowed,scenario,checks,diagonal,blockedEntry,logicalMismatch});
  }
  return {mode,hz,results,fingerprint:online?String(fingerprint):null};
 }finally{Date.now=oldNow;}
};
try{
 for(const hz of[30,60,144]){const page=await open();results.push(await page.evaluate(exercise,{mode:'single',hz}));await page.close();}
 const page=await open(),peer=await open();const online=await page.evaluate(exercise,{mode:'online-two',hz:60});
 assert.deepEqual(await peer.evaluate(exercise,{mode:'online-two',hz:60}),online,'Independent clients must match each movement frame');results.push(online);
 assert.deepEqual(errors,[]);await mkdir(output,{recursive:true});await writeFile(resolve(output,'results.json'),JSON.stringify({baseURL:base,results},null,2)+'\n');
 console.log(JSON.stringify({baseURL:base,passed:results.reduce((n,r)=>n+r.results.length,0),results},null,2));
}finally{await browser.close();}
