const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const { URL } = require("url");
const { execSync } = require("child_process");

const categories = JSON.parse(fs.readFileSync("categories.json"));

// ==========================
// รับชื่อหมวดจาก command line
// ==========================
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

// =========================
// AXIOS CONFIG
// =========================
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

// ==========================
// FETCH WITH RETRY
// ==========================
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

// ==========================
// SITE HANDLERS
// ==========================
const SiteHandlers = {

  // ======================
  // DEFAULT HANDLER
  // ======================
  default: {
    articleSelectors: [
      "article",".movie-item",".post",".item",".anime-item",".-movie"
    ],
    episodeSelectors: [
      "ul#MVP li a",".episode-list a",".ep a",".episodes a",".mp-ep-btn"
    ],
    async getServers(epUrl) {
      const { data } = await fetchWithRetry(epUrl);
      const $ = cheerio.load(data);

      let servers = [];

      const main =
        $("div.mpIframe iframe").attr("data-src") ||
        $("div.mpIframe iframe").attr("src");

      if (main) servers.push({ name:"Main", url:main });

      $(".toolbar-item.mp-s-sl").each((i,el)=>{
        const name=$(el).find(".item-text").text().trim();
        const id=$(el).attr("data-id");
        if (id) servers.push({ name:name||`Player ${i+1}`, url:id });
      });

      return servers;
    }
  },

  // ======================
  // 123HDTV
  // ======================
  "123hdtv.com": {
    articleSelectors: [
      ".grid-item",".item-movie",".movie","article"
    ],
    episodeSelectors: [
      ".list-episode a",".episode-item a",".episodes a"
    ],
    async getServers(epUrl) {
      const { data } = await fetchWithRetry(epUrl);
      const $ = cheerio.load(data);
      let servers = [];

      $("iframe").each((i,el)=>{
        const src=$(el).attr("data-src")||$(el).attr("src");
        if (src) servers.push({ name:`Server ${i+1}`, url:src });
      });

      return servers;
    }
  }

};

// ==========================
// SELECT HANDLER
// ==========================
function getHandler(url) {
  const domain = getDomain(url);
  return SiteHandlers[domain] || SiteHandlers.default;
}

// ==========================
// AUTO DETECT HELPERS
// ==========================
function autoDetect($, selectors) {
  for (const sel of selectors) {
    const found = $(sel);
    if (found.length>0) {
      console.log("🔍 ใช้ selector:", sel);
      return found;
    }
  }
  return [];
}

function extractBasicInfo($, el) {
  const title =
    $(el).find(".entry-title,.title,h2,h3").first().text().trim();

  const link=$(el).find("a").attr("href");
  const image=$(el).find("img").attr("data-src")||
               $(el).find("img").attr("src");

  return { title, link, image };
}

// ==========================
// FILE SIZE CONTROL
// ==========================
const MAX_FILE_SIZE = 5*1024*1024;

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

// ==========================
// MAIN
// ==========================
(async()=>{

if(!fs.existsSync("data")) fs.mkdirSync("data");

const progressFile = `data/${cat.slug}_progress.json`;

let startPage = 1;

if (fs.existsSync(progressFile)) {

  const saved = JSON.parse(fs.readFileSync(progressFile));
  startPage = saved.page || 1;

  console.log("🔁 Resume จากหน้า", startPage);

} else {

  // ⭐ เพิ่มตรงนี้
  fs.writeFileSync(
    progressFile,
    JSON.stringify({ page: 1 }, null, 2)
  );

  console.log("🆕 สร้าง progress ใหม่");

}

let fileIndex=1;
let currentData=[];
let currentFilePath=`data/${cat.slug}_${fileIndex}.json`;

const oldMap=new Map();

const files = fs.readdirSync("data")
  .filter(f =>
    f.startsWith(cat.slug + "_") &&
    f.endsWith(".json") &&
    !f.includes("progress")
  );

if(files.length>0){

  const indexes = files
  .map(f => {
    const m = f.match(/_(\d+)\.json$/);
    return m ? parseInt(m[1]) : null;
  })
  .filter(x => x !== null);

  fileIndex = Math.max(...indexes);

  currentFilePath = `data/${cat.slug}_${fileIndex}.json`;

}

for(const file of files){
  let data = [];

try{
  data = JSON.parse(fs.readFileSync(`data/${file}`));
}catch(e){
  console.log("⚠️ json error:", file);
}
  data.forEach(m=>{
    if(!m.episodes)m.episodes=[];
    oldMap.set(m.link,m);
  });
}

if (fs.existsSync(currentFilePath)) {
  try {
    currentData = JSON.parse(fs.readFileSync(currentFilePath));
  } catch {
    currentData = [];
  }
} else {
  currentData = [];
}

currentData.forEach(m=>{
  oldMap.set(m.link,m);
});

function saveWithSizeCheck(){
  const json = JSON.stringify(currentData, null, 2);

  if (Buffer.byteLength(json) > MAX_FILE_SIZE) {

    const last = currentData.pop();

    fs.writeFileSync(
      currentFilePath,
      JSON.stringify(currentData, null, 2)
    );

    fileIndex++;
    currentFilePath = `data/${cat.slug}_${fileIndex}.json`;
    currentData = [last];

  } else {

    // ✅ เพิ่มบรรทัดนี้เข้าไป
    fs.writeFileSync(currentFilePath, json);

  }
}

const handler = getHandler(cat.url);
let finished = false;
let episodeCounter = 0;

//save auto
setInterval(()=>{
  if(currentData.length > 0){
    fs.writeFileSync(
      currentFilePath,
      JSON.stringify(currentData,null,2)
    );
    console.log("💾 Auto save");
  }
}, 5*60*1000);

//LOOP

for (let page = startPage; page <= 999; page++) {

  // ⭐ เพิ่มตรงนี้
  fs.writeFileSync(
    progressFile,
    JSON.stringify({ page: page }, null, 2)
  );

  console.log("📄 หน้า", page);

  let pageSuccess = false;

  try {

    const { data: catHtml } =
      await fetchWithRetry(`${cat.url}/page/${page}`);

    const $cat = cheerio.load(catHtml);

    const articles =
      autoDetect($cat, handler.articleSelectors).toArray();

    if (articles.length === 0) {

      console.log("ไม่มีข้อมูลแล้ว");

      finished = true;

      fs.writeFileSync(
        progressFile,
        JSON.stringify({ page: page })
      );

      break;
    }

    for (const el of articles) {

      const basic = extractBasicInfo($cat, el);
      if (!basic.title) continue;

      const link = normalizeUrl(basic.link);
      if (!link) continue;

      // ⭐ เพิ่มตรงนี้
      if (oldMap.has(link)) {
        console.log("🌐 ซ้ำข้ามหมวด:", basic.title);
        continue;
      }

      let movie = oldMap.get(link);
      

      if (movie && movie.episodes && movie.episodes.length > 0) {
        console.log("⏭ ข้ามเรื่อง (มีแล้ว):", movie.title);
        continue;
      }

      if (!movie) {
        movie = {
          title: basic.title,
          link,
          image: basic.image || "",
          episodes: []
        };

        currentData.push(movie);
        oldMap.set(link, movie);
        saveWithSizeCheck();
      }

      const { data: detailHtml } =
        await fetchWithRetry(link);

      const $detail = cheerio.load(detailHtml);

      const epElements =
        autoDetect($detail, handler.episodeSelectors).toArray();

      for (const el2 of epElements) {

        const $a = $detail(el2);

        let epLink = normalizeUrl($a.attr("href"));
        if (!epLink) continue;

        if (movie.episodes.find(x => x.link === epLink)) {
          console.log("⛔ ตอนซ้ำ หยุดเรื่อง");
          break;
        }

        console.log("↳ ดึงตอน:", $a.text().trim());

        const siteHandler = getHandler(epLink);

        let servers = [];

        try {
          servers = await siteHandler.getServers(epLink);
        } catch (err) {
          console.log("⚠️ server error:", epLink);
        }

        movie.episodes.push({
          name: $a.text().trim(),
          link: epLink,
          servers
        });

        episodeCounter++;

        saveWithSizeCheck();

        if (episodeCounter % 50 === 0) {

          console.log("🚀 commit partial");

          commitProgress(
            `update ${cat.slug} episodes ${episodeCounter}`
          );
        }

        await randomDelay();
      }

    }

    pageSuccess = true;

  } catch (err) {

    console.log("⚠️ ข้ามหน้า", page);

  }

  if (pageSuccess) {

    saveWithSizeCheck();

    commitProgress(
      `update ${cat.slug} page ${page}`
    );

    fs.writeFileSync(
      progressFile,
      JSON.stringify({ page: page + 1 })
    );

    console.log("💾 บันทึก progress:", page + 1);

  }

  await randomDelay(1500, 2500);

}

if(currentData.length>0){
  fs.writeFileSync(currentFilePath,
    JSON.stringify(currentData,null,2));
}
if (finished) {
  console.log("SCRAPER_STATUS:FINISHED");
} else {
  console.log("SCRAPER_STATUS:IN_PROGRESS");
}
console.log("✅ เสร็จหมวด:",cat.name);



})();
