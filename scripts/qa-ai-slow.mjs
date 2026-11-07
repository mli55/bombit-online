/* Gas-triggered AI movement in real native/online engines and independent replay. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
const base=(process.env.BASE_URL||'http://localhost:3000').replace(/\/$/,'');
const output=resolve(process.env.QA_OUTPUT_DIR||'.local/ai-slow-qa');
const errors=[],results=[];
async function open(){
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 if(process.env.QA_AI_SOURCE){const source=await readFile(process.env.QA_AI_SOURCE,'utf8');await page.route('**/classic-ai.js',route=>route.fulfill({contentType:'text/javascript',body:source}));}
 await page.goto(base+'/game/?ai-slow-qa');await page.waitForFunction(()=>window.onlineBridge?.state==='mainMenuState');return page;
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
  for(const [index,[dx,dy]]of directions.entries())for(const scenario of ['gas','expire','freeze']){
   if(online)onlineBridge.start({seed:'ai-slow',campaignSeed:'ai-slow',difficulty:1,round:1,scores:[0,0,0,0],players:[{seat:0,character:0},{seat:1,character:1}]});
   else{game.rnd.sow(['ai-slow']);game.state.start('gameplayState',true,false,Game.GAME_MODE.ARCADE,1,Game.PLAYER_MODE.SINGLE_PLAYER,Game.MAP_THEME.RANDOM,[0],1);for(let i=0;i<4;i++)advance();}
   const state=game.state.getCurrentState(),grid=state.grid,bot=grid.players.find(p=>p.isAI),human=grid.players.find(p=>!p.isAI);
   for(const p of grid.players){p.invincible=true;p.invincibilityTimer=-1e8;if(p.isAI)p.classicThink=()=>{};}
   for(const b of grid.boxes)b.destroy();grid.boxes=[];
   for(const col of grid.cells)for(const c of col){c.cellContains=Game.MAP.WALL;c.isEmpty=false;c.isDangerCell=c.isFreezeCell=c.isItemCell=false;}
   const start=grid.cells[6][5],corner=grid.cells[6+dx][5+dy],end=grid.cells[6+dx-dy][5+dy+dx];
   for(const c of[start,corner,end]){c.cellContains=Game.MAP.FREE;c.isEmpty=true;}
   // Release a real gas mine; the existing danger check must apply slow as the
   // bot enters its cell halfway through the first segment.
   place(human,corner);human.createWeapon(Game.ITEM_TYPE.BATTERY);human.useWeapon();const mine=grid.mines[0];place(human,grid.cells[0][0]);
   place(bot,start);bot.invincible=false;bot.invulnerable=false;bot.initialBlinking=false;bot.moving=false;bot.movingAnimation=false;
   check(bot.classicBeginMove(index),'corridor entry');
   const points=[],cellWidth=Game.SETTINGS.CELL_WIDTH;let previous={x:bot.x,y:bot.y},sawSlow=false;
   const track=(vx,vy)=>{
    advance();const mx=bot.x-previous.x,my=bot.y-previous.y;
    check(Math.abs(mx)<1e-6||Math.abs(my)<1e-6,'diagonal movement '+JSON.stringify({previous,x:bot.x,y:bot.y}));
    check(mx*vx+my*vy>=-1e-6,'position rewound after slow');
    const x=Math.floor(bot.x/cellWidth),y=Math.floor(bot.y/cellWidth);
    check(grid.cells[x]?.[y]?.cellContains!==Game.MAP.WALL,'crossed solid terrain');
    check(x===bot.gridPositionX&&y===bot.gridPositionY,'physical/logical cell mismatch');
    points.push([bot.x,bot.y]);previous={x:bot.x,y:bot.y};sawSlow||=bot.slowed;
   };
   let steps=0;while(bot.moving&&steps++<120){
    track(dx,dy);
    if(bot.slowed&&scenario==='expire')bot.slowTimer=Game.SETTINGS.SLOW_TIME-1;
    if(bot.slowed&&scenario==='freeze'&&!bot.__testedFreeze){
     bot.__testedFreeze=true;bot.frozen=true;bot.frozenTimer=0;const x=bot.x,y=bot.y;
     for(let i=0;i<12;i++)track(dx,dy);
     check(bot.x===x&&bot.y===y,'frozen bot kept moving');bot.frozen=false;
     state.pauseGame();for(let i=0;i<12;i++)track(dx,dy);check(bot.x===x&&bot.y===y,'paused bot kept moving');state.unpauseGame();
    }
   }
   check(sawSlow&&!mine.exists,'gas was actually triggered');
   check(!bot.moving&&bot.x===corner.centerX&&bot.y===corner.centerY,'first segment did not end at correct center');
   const turn=directions.findIndex(([x,y])=>x===-dy&&y===dx);check(bot.classicBeginMove(turn),'corner turn');
   steps=0;while(bot.moving&&steps++<120)track(-dy,dx);
   check(!bot.moving&&bot.x===end.centerX&&bot.y===end.centerY,'turn did not end at correct center');
   results.push({direction:index,scenario,gasTriggered:true,points:points.length,end:[bot.gridPositionX,bot.gridPositionY]});
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
