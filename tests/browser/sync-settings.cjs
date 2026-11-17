/** 单用户同步协议/失败保护/本机设置。默认模拟远端，LIVE_SYNC=1时检查已授权的真实私有仓库。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium, firefox, webkit } = require("playwright-core");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765/";
const ENGINE = process.env.BROWSER || "chrome";
const LIVE = process.env.LIVE_SYNC === "1";
const OUT = path.resolve(__dirname, "../../_work/finalization/browser");
const checks = [], errors = [];
const check = (name, ok) => { checks.push({ name, ok: Boolean(ok) }); console.log((ok?"PASS ":"FAIL ")+name); assert.ok(ok,name); };

(async () => {
 fs.mkdirSync(OUT,{recursive:true});
 const browser=await (ENGINE==="webkit"?webkit:ENGINE==="firefox"?firefox:chromium).launch(
   ["webkit","firefox"].includes(ENGINE)?{headless:true}:{headless:true,channel:ENGINE});
 const a=await browser.newContext(),b=await browser.newContext();
 let remote=null,version=0,conflict=false,publicRepo=false,invalid=false,puts=0;
 if (!LIVE) {
  for (const context of [a,b]) await context.route("https://api.github.com/**",async route=>{
   const request=route.request(),url=new URL(request.url());
   if (request.method()==="OPTIONS") return route.fulfill({status:204,headers:{"access-control-allow-origin":"*","access-control-allow-headers":"*"}});
   const headers={"access-control-allow-origin":"*"};
   if (!url.pathname.includes("/contents/")) return route.fulfill({json:{private:!publicRepo,archived:false},headers});
   if (request.method()==="GET") return route.fulfill(remote?{json:{
     sha:String(version),encoding:"base64",content:Buffer.from(invalid?'{"bad":true}':JSON.stringify(remote)).toString("base64")},headers}:{status:404,json:{message:"Not Found"},headers});
   const next=request.postDataJSON();puts++;
   if (conflict) { conflict=false;version++;return route.fulfill({status:409,json:{message:"Conflict"},headers}); }
   if (remote && next.sha!==String(version)) return route.fulfill({status:409,json:{message:"Conflict"},headers});
   remote=JSON.parse(Buffer.from(next.content,"base64").toString("utf8"));version++;
   return route.fulfill({json:{content:{sha:String(version)}},headers});
  });
 } else {
  // 真远端验收使用独立文件，不触碰用户正式progress-v1.json。
  for (const context of [a,b]) await context.route("https://api.github.com/**",route=>{
   const url=route.request().url().replace("/contents/progress-v1.json","/contents/acceptance-v1.json");
   return route.continue({url});
  });
 }
 for (const context of [a,b]) context.on("page",page=>page.on("pageerror",e=>errors.push(e.message)));
 const pa=await a.newPage(),pb=await b.newPage();
 const visit=async (page,hash)=>{
  await page.goto(BASE+hash,{waitUntil:"networkidle"});
  if (hash.startsWith("#/q/")) {
   await page.waitForFunction(id=>document.querySelector(".qcard")?.dataset.qid===id,hash.slice(4));
  } else if (hash==="#/settings") {
   await page.getByRole("heading",{name:"设置与同步",exact:true}).waitFor();
  }
 };
 const initialize=async page=>{
  await visit(page,"#/settings");
  const token=LIVE?execFileSync("gh",["auth","token"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim():"mock-private-repository-token";
  await page.evaluate(async value=>{
   const settings=await import("./js/settings.js");
   settings.saveSettings({syncRepository:"dou307/os-exercises-progress",syncAuto:false});
   settings.setToken(value);
  },token);
 };
 const sync=page=>page.evaluate(async()=>{
  try { await (await import("./js/sync.js")).syncNow();return {ok:true}; }
  catch(e){return {ok:false,message:e.message};}
 });
 try {
  await initialize(pa);await initialize(pb);
  if (!LIVE) {
   await pa.evaluate(()=>window.__osExercises.storage.saveDraft("c1-s5-0-q001",""));
   check("首次仅有删除标记也上传",(await sync(pa)).ok && remote?.draftChanges?.["c1-s5-0-q001"] && !remote.drafts["c1-s5-0-q001"]);
  }
  await pa.evaluate(()=>{
   window.__osExercises.storage.setFavorite("c1-s1-0-q001",true);
   window.__osExercises.storage.recordAnswer("c1-s1-0-q001","C",true,"auto");
  });
  check("设备A上传私有收藏",(await sync(pa)).ok);
  check("设备B下载并合并收藏",(await sync(pb)).ok && await pb.evaluate(()=>window.__osExercises.storage.isFavorite("c1-s1-0-q001")));
  check("设备B取得提交选项、结果与次数",await pb.evaluate(()=>{
   const a=window.__osExercises.storage.getAnswer("c1-s1-0-q001");return a?.selected==="C"&&a.correct===true&&a.attempts===1;
  }));
  await pb.evaluate(()=>{
   const s=window.__osExercises.storage;
   s.setFavorite("c1-s1-0-q001",false);
   s.saveDraft("c1-s5-0-q001","跨设备自答草稿");
   s.setUI({completedChapters:["3"]});
  });
  check("设备B可上传取消收藏、草稿和学习标记",(await sync(pb)).ok);
  await sync(pa);
  check("设备A采用较新取消和草稿",await pa.evaluate(()=>{
   const s=window.__osExercises.storage;return !s.isFavorite("c1-s1-0-q001")&&s.getDraft("c1-s5-0-q001")==="跨设备自答草稿"&&s.getUI().completedChapters.includes("3");
  }));
  await pa.evaluate(()=>{
   const s=window.__osExercises.storage;s.saveDraft("c1-s5-0-q001","");s.setUI({completedChapters:[]});
  });
  await sync(pa);await sync(pb);
  check("草稿删除与取消已学也能同步",await pb.evaluate(()=>{
   const s=window.__osExercises.storage;return !s.getDraft("c1-s5-0-q001")&&!s.getUI().completedChapters.includes("3");
  }));
  check("令牌不进入导出或普通本地设置",await pa.evaluate(()=>{
   const text=JSON.stringify(window.__osExercises.storage.exportData())+(localStorage.getItem("os-exercises:settings:v1")||"");
   return !text.includes(sessionStorage.getItem("os-exercises:github-token"));
  }));
  if (!LIVE) {
   await pa.evaluate(()=>window.__osExercises.storage.setFavorite("c1-s1-0-q002",true));
   conflict=true;
   check("SHA冲突自动重读合并后重试",(await sync(pa)).ok);
   const before=await pa.evaluate(()=>JSON.stringify(window.__osExercises.storage.exportData().answers));
   invalid=true;
   const bad=await sync(pa);
   check("损坏远端拒绝同步，本机记录不丢",!bad.ok&&before===await pa.evaluate(()=>JSON.stringify(window.__osExercises.storage.exportData().answers)));
   invalid=false;publicRepo=true;const writes=puts;
   check("公开仓库拒绝上传",(await sync(pa)).ok===false && puts===writes);
   publicRepo=false;
   await pa.route("https://api.github.com/**",route=>route.abort());
   check("断网失败明确返回且本机记录保留",!(await sync(pa)).ok&&before===await pa.evaluate(()=>JSON.stringify(window.__osExercises.storage.exportData().answers)));
   await pa.unroute("https://api.github.com/**");
   await pa.evaluate(async()=>{
    const s=window.__osExercises.storage;
    const idx=(await(await fetch("data/index.json")).json()).questions;
    s.importData(JSON.stringify({schemaVersion:1,answers:{},drafts:{"c1-s5-0-q002":"本机旧草稿"}}),new Map(idx.map(q=>[q.id,q])));
   });
   remote.drafts["c1-s5-0-q002"]="远端旧草稿";
   delete remote.draftChanges["c1-s5-0-q002"];
   const conflicts=puts;
   check("无时间的旧草稿冲突不猜测覆盖",!(await sync(pa)).ok && puts===conflicts && await pa.evaluate(()=>window.__osExercises.storage.getDraft("c1-s5-0-q002")==="本机旧草稿"));
   await pa.evaluate(()=>window.__osExercises.storage.saveDraft("c1-s5-0-q002","用户明确保存的草稿"));
   check("明确编辑后可解决旧草稿冲突",(await sync(pa)).ok && remote.drafts["c1-s5-0-q002"]==="用户明确保存的草稿");
  }
  await pa.evaluate(async()=>{
   const s=await import("./js/settings.js");s.saveSettings({notesVault:"Obsidian",notesPrefix:"1大三秋冬/OS"});
  });
  await visit(pa,"#/q/c1-s1-0-q001");
  const href=await pa.locator('a[href^="obsidian:"]').getAttribute("href");
  check("Obsidian链接包括真实库内相对目录",new URL(href).searchParams.get("file")==="1大三秋冬/OS/1-Introduction.md");
  await visit(pa,"#/settings");
  await pa.getByLabel("库名称",{exact:true}).fill("Obsidian");
  await pa.getByLabel("课程笔记在库内的相对目录",{exact:true}).fill("1大三秋冬/OS");
  await pa.getByRole("button",{name:"保存笔记设置",exact:true}).click();
  check("保存后立即提供笔记测试链接",await pa.getByRole("link",{name:"测试打开第一章笔记",exact:true}).count()===1);
  await visit(pa,"#/q/c2-s6-0-q006");
  check("争议复审不会在作答前泄露",!await pa.locator(".dispute-followup").isVisible());
  await pa.getByRole("button",{name:"查看解析",exact:true}).click();
  check("展开解析可见争议复审",await pa.locator(".dispute-followup").isVisible());
  await visit(pa,"#/q/c4-s2-0-q051");
  check("错误年份单独显示存档反证",(await pa.locator(".year-audit").innerText()).includes("2009"));
  const legacy=await pa.evaluate(async()=>{
   const s=window.__osExercises.storage;
   const idx=(await(await fetch("data/index.json")).json()).questions;
   const records=idx.filter(q=>/^c[45]-/.test(q.id)&&q.legacyAutoAllowed).slice(0,2);
   const old={selected:"A",correct:false,scoring:"auto",firstCorrect:false,attempts:2,firstAt:"2026-10-20T10:00:00Z",lastAt:"2026-10-21T10:00:00Z"};
   const result=s.importData(JSON.stringify({schemaVersion:1,answers:Object.fromEntries(records.map(q=>[q.id,old]))}),new Map(idx.map(q=>[q.id,q])));
   return result.ok && records.every(q=>s.exportData().answers[q.id].correct===false&&s.getAnswer(q.id).correct===null&&s.getAnswer(q.id).scoringRetired);
  });
  check("新争议可保留旧分数且当前停止计分",legacy);
  await visit(pa,"#/q/c5-s2-0-q009");
  check("I/O空标题明确提示前置缺口",(await pa.locator(".qcard").innerText()).includes("HTML注释"));
  await visit(pa,"#/q/c5-s4-3-q006");
  check("C-SCAN条件缺失题排除自动计分",(await pa.locator(".qhead").innerText()).includes("待核对"));
  await pa.setViewportSize({width:390,height:844});
  await visit(pa,"#/settings");
  check("安卓尺寸设置页无横向溢出",await pa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await pa.evaluate(()=>window.scrollTo(0,0));
  await pa.screenshot({path:path.join(OUT,ENGINE+"-settings.png"),fullPage:true,animations:"disabled"});
  if (!LIVE) {
   await pa.evaluate(async()=>{
    (await import("./js/settings.js")).saveSettings({syncAuto:true});
    window.__osExercises.storage.setFavorite("c1-s1-0-q005",true);
   });
   const deadline=Date.now()+10000;
   while(!remote?.favorites?.["c1-s1-0-q005"]?.saved && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,100));
   check("启用自动同步后修改会上传",remote?.favorites?.["c1-s1-0-q005"]?.saved);
   await pa.getByRole("button",{name:"断开本次连接",exact:true}).click();
   check("断开清除会话令牌但保留记录",await pa.evaluate(async()=>!(await import("./js/settings.js")).getToken()&&window.__osExercises.storage.isFavorite("c1-s1-0-q005")));
  }
  check("无页面脚本错误",errors.length===0);
 } finally {
  fs.writeFileSync(path.join(OUT,(LIVE?"live-":"")+ENGINE+"-sync.json"),JSON.stringify({checks,errors,live:LIVE},null,2));
  await a.close();await b.close();await browser.close();
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
