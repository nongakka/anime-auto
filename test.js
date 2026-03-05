const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const { URL } = require("url");
const { execSync } = require("child_process");

const categories = JSON.parse(fs.readFileSync("categories.json"));

const selectedSlug = process.argv[2];

if (!selectedSlug) {
  console.log("❌ กรุณาระบุ slug");
  process.exit(1);
}

const cat = categories.find(c => c.slug === selectedSlug);
if (!cat) {
  console.log("❌ ไม่พบหมวด:", selectedSlug);
  process.exit(1);
}

console.log("🎯 เลือกหมวด:", cat.name);

const client = axios.create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "th-TH,th;q=0.9"
  },
  timeout: 20000
});

const delay = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = (min=700,max=1500) =>
  delay(Math.floor(Math.random()*(max-min))+min);

function normalizeUrl(url) {
  if (!url) return null;
  return url.split("?")[0].replace(/\/+$/, "");
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace("www.","");
  } catch {
    return "";
  }
}

async function fetchWithRetry(url, retries=3) {
  for (let i=0;i<retries;i++) {
    try {
      return await client.get(url);
    } catch (err) {
      if (i===retries-1) throw err;
      console.log("🔁 retry:", url);
      await delay(1000);
    }
  }
}

//////////////////////////////////////////////////////////////////
// ULTRA SCRAPER V3
//////////////////////////////////////////////////////////////////

function extractFromHTML($, add){

  $("iframe").each((i,el)=>{
    const src=$(el).attr("src")||
              $(el).attr("data-src")||
              $(el).attr("data-lazy-src");
    if(src) add(src,"iframe");
  });

  $("video source").each((i,el)=>{
    const src=$(el).attr("src");
    if(src) add(src,"video");
  });

  $("source").each((i,el)=>{
    const src=$(el).attr("src");
    if(src) add(src,"source");
  });

  $("[data-src],[data-video],[data-stream]").each((i,el)=>{
    const src=$(el).attr("data-src")||
               $(el).attr("data-video")||
               $(el).attr("data-stream");
    if(src) add(src,"data");
  });

}

function extractFromScript($, add){

  $("script").each((i,el)=>{

    const text=$(el).html();
    if(!text) return;

    const m3u8=text.match(/https?:\/\/[^"' ]+\.m3u8/g);
    if(m3u8) m3u8.forEach(url=>add(url,"m3u8"));

    const mp4=text.match(/https?:\/\/[^"' ]+\.mp4/g);
    if(mp4) mp4.forEach(url=>add(url,"mp4"));

    const embed=text.match(/https?:\/\/[^"' ]+\/embed[^"' ]*/g);
    if(embed) embed.forEach(url=>add(url,"embed"));

    const jw=text.match(/file:\s*["']([^"']+)["']/g);

    if(jw){
      jw.forEach(x=>{
        const m=x.match(/["']([^"']+)["']/);
        if(m) add(m[1],"jwplayer");
      });
    }

  });

}

async function ultraExtractServersV3(url){

  const { data } = await fetchWithRetry(url);

  const $ = cheerio.load(data);

  const servers=[];
  const seen=new Set();

  function add(url,type){

    if(!url) return;

    url=url.trim();

    if(seen.has(url)) return;

    seen.add(url);

    servers.push({
      name:type,
      url
    });

  }

  extractFromHTML($,add);
  extractFromScript($,add);

  $("a").each((i,el)=>{

    const href=$(el).attr("href");

    if(!href) return;

    if(
      href.includes("embed") ||
      href.includes("player") ||
      href.includes("stream")
    ){
      add(href,"link");
    }

  });

  return servers;

}

//////////////////////////////////////////////////////////////////
// SITE HANDLERS
//////////////////////////////////////////////////////////////////

const SiteHandlers = {

  default: {
    articleSelectors: [
      "article",".movie-item",".post",".item",".anime-item",".-movie"
    ],

    episodeSelectors: [
      ".eplister a",
      ".episode-list a",
      ".episodes a",
      ".ep a",
      "ul li a[href*='episode']",
      "a[href*='ep-']"
    ],

    async getServers(epUrl){
      return await ultraExtractServersV3(epUrl);
    }
  },

  "123hdtv.com": {
    articleSelectors:[
      ".grid-item",".item-movie",".movie","article"
    ],

    episodeSelectors:[
      ".list-episode a",".episode-item a",".episodes a"
    ],

    async getServers(epUrl){
      return await ultraExtractServersV3(epUrl);
    }
  }

};

function getHandler(url){
  const domain=getDomain(url);
  return SiteHandlers[domain]||SiteHandlers.default;
}

//////////////////////////////////////////////////////////////////

function autoDetect($,selectors){
  for(const sel of selectors){
    const found=$(sel);
    if(found.length>0){
      console.log("🔍 ใช้ selector:",sel);
      return found;
    }
  }
  return [];
}

function extractBasicInfo($,el){

  const title=$(el)
  .find(".entry-title,.title,h2,h3")
  .first()
  .text()
  .trim();

  const link=$(el).find("a").attr("href");

  const image=$(el)
  .find("img")
  .attr("data-src")||
  $(el).find("img").attr("src");

  return {title,link,image};

}

//////////////////////////////////////////////////////////////////

const MAX_FILE_SIZE=5*1024*1024;

function commitProgress(message){

  try{

    execSync("git config user.name 'github-actions'");
    execSync("git config user.email 'actions@github.com'");

    execSync("git add data");

    try{
      execSync(`git commit -m "${message}"`);
    }catch{
      console.log("ไม่มีการเปลี่ยนแปลง");
      return;
    }

    execSync("git pull --rebase origin main");
    execSync("git push");

    console.log("🚀 pushed to github");

  }catch(err){
    console.log("⚠️ push error");
  }

}

//////////////////////////////////////////////////////////////////
// MAIN
//////////////////////////////////////////////////////////////////

(async()=>{

if(!fs.existsSync("data")) fs.mkdirSync("data");

const progressFile=`data/${cat.slug}_progress.json`;

let startPage=1;

if(fs.existsSync(progressFile)){
  const saved=JSON.parse(fs.readFileSync(progressFile));
  startPage=saved.page||1;
  console.log("🔁 Resume จากหน้า",startPage);
}

let fileIndex=1;
let currentData=[];
let currentFilePath=`data/${cat.slug}_${fileIndex}.json`;

const oldMap=new Map();

const files=fs.readdirSync("data")
.filter(f=>f.startsWith(cat.slug+"_")&&f.endsWith(".json")&&!f.includes("progress"));

if(files.length>0){

const indexes=files.map(f=>{
const m=f.match(/_(\d+)\.json/);
return m?parseInt(m[1]):1;
});

fileIndex=Math.max(...indexes);

currentFilePath=`data/${cat.slug}_${fileIndex}.json`;

}

for(const file of files){

let data=[];

try{
data=JSON.parse(fs.readFileSync(`data/${file}`));
}catch(e){
console.log("⚠️ json error:",file);
}

data.forEach(m=>{
if(!m.episodes)m.episodes=[];
oldMap.set(m.link,m);
});

}

if(fs.existsSync(currentFilePath)){
try{
currentData=JSON.parse(fs.readFileSync(currentFilePath));
}catch{
currentData=[];
}
}else{
currentData=[];
}

currentData.forEach(m=>{
oldMap.set(m.link,m);
});

function saveWithSizeCheck(){

const json=JSON.stringify(currentData,null,2);

if(Buffer.byteLength(json)>MAX_FILE_SIZE){

const last=currentData.pop();

fs.writeFileSync(currentFilePath,
JSON.stringify(currentData,null,2));

fileIndex++;

currentFilePath=`data/${cat.slug}_${fileIndex}.json`;

currentData=[last];

}else{

fs.writeFileSync(currentFilePath,json);

}

}

const handler=getHandler(cat.url);

let finished=false;

let episodeCounter=0;

setInterval(()=>{

if(currentData.length>0){

fs.writeFileSync(currentFilePath,
JSON.stringify(currentData,null,2));

console.log("💾 Auto save");

}

},5*60*1000);

for(let page=startPage;page<=999;page++){

console.log("📄 หน้า",page);

let pageSuccess=false;

try{

const {data:catHtml}=
await fetchWithRetry(`${cat.url}/page/${page}`);

const $cat=cheerio.load(catHtml);

const articles=
autoDetect($cat,handler.articleSelectors).toArray();

if(articles.length===0){

console.log("ไม่มีข้อมูลแล้ว");

finished=true;

fs.writeFileSync(progressFile,
JSON.stringify({page:page}));

break;

}

for(const el of articles){

const basic=extractBasicInfo($cat,el);

if(!basic.title)continue;

const link=normalizeUrl(basic.link);

if(!link)continue;

let movie=oldMap.get(link);

if(movie&&movie.episodes&&movie.episodes.length>0){
console.log("⏭ ข้ามเรื่อง:",movie.title);
continue;
}

if(!movie){

movie={
title:basic.title,
link,
image:basic.image||"",
episodes:[]
};

currentData.push(movie);
oldMap.set(link,movie);

saveWithSizeCheck();

}

const {data:detailHtml}=await fetchWithRetry(link);

const $detail=cheerio.load(detailHtml);

const epElements=
autoDetect($detail,handler.episodeSelectors).toArray();

for(const el2 of epElements){

const $a=$detail(el2);

let epLink=normalizeUrl($a.attr("href"));

if(!epLink)continue;

if(movie.episodes.find(x=>x.link===epLink)){
console.log("⛔ ตอนซ้ำ");
break;
}

console.log("↳ ตอน:",$a.text().trim());

const siteHandler=getHandler(epLink);

let servers=[];

try{
servers=await siteHandler.getServers(epLink);
}catch(err){
console.log("⚠️ server error:",epLink);
}

movie.episodes.push({
name:$a.text().trim(),
link:epLink,
servers
});

episodeCounter++;

saveWithSizeCheck();

if(episodeCounter%50===0){

console.log("🚀 commit partial");

commitProgress(`update ${cat.slug} episodes ${episodeCounter}`);

}

await randomDelay();

}

}

pageSuccess=true;

}catch(err){

console.log("⚠️ ข้ามหน้า",page);

}

if(pageSuccess){

saveWithSizeCheck();

commitProgress(`update ${cat.slug} page ${page}`);

fs.writeFileSync(progressFile,
JSON.stringify({page:page+1}));

console.log("💾 บันทึก progress:",page+1);

}

await randomDelay(1500,2500);

}

if(currentData.length>0){

fs.writeFileSync(currentFilePath,
JSON.stringify(currentData,null,2));

}

if(finished){
console.log("SCRAPER_STATUS:FINISHED");
}else{
console.log("SCRAPER_STATUS:IN_PROGRESS");
}

console.log("✅ เสร็จหมวด:",cat.name);

})();
