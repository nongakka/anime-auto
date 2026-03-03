const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const categories = JSON.parse(fs.readFileSync("categories.json"));

// ==========================
// รับชื่อหมวดจาก command line
// ==========================
const selectedSlug = process.argv[2];

if (!selectedSlug) {
  console.log("❌ กรุณาระบุ slug หมวด");
  console.log("ตัวอย่าง: node app.js thai");
  process.exit(1);
}

const cat = categories.find(c => c.slug === selectedSlug);

if (!cat) {
  console.log("❌ ไม่พบหมวด:", selectedSlug);
  process.exit(1);
}

console.log("🎯 เลือกหมวด:", cat.name);

// =========================
// ตั้งค่าป้องกันโดนบล็อก
// =========================
const client = axios.create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "th-TH,th;q=0.9"
  },
  timeout: 20000
});

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function randomDelay(min = 700, max = 1500) {
  return new Promise(r =>
    setTimeout(r, Math.floor(Math.random() * (max - min)) + min)
  );
}

function normalizeUrl(url) {
  if (!url) return null;

  return url
    .split("?")[0]
    .replace(/\/+$/, "");
}

// ==========================
// ดึง server จากหน้า episode
// ==========================
async function getEpisodeServers(epUrl) {
  try {
    const { data } = await fetchWithRetry(epUrl);
    const $ = cheerio.load(data);

    let servers = [];

    const mainIframe =
      $("div.mpIframe iframe").attr("data-src") ||
      $("div.mpIframe iframe").attr("src");

    if (mainIframe) {
      servers.push({ name: "Main", url: mainIframe });
    }

    $(".toolbar-item.mp-s-sl").each((i, el) => {
      const name = $(el).find(".item-text").text().trim();
      const url = $(el).attr("data-id");

      if (url) {
        servers.push({
          name: name || `Player ${i + 1}`,
          url
        });
      }
    });

    return servers;
  } catch (err) {
    console.log("❌ ดึง server ไม่ได้:", epUrl);
    return [];
  }
}

// ==========================
// AUTO DETECT STRUCTURE
// ==========================

function autoDetectArticles($) {
  const selectors = [
  "article",
  ".movie-item",
  ".post",
  ".item",
  ".anime-item",
  ".-movie" // ✅ เพิ่มอันนี้
];

  for (const sel of selectors) {
    const found = $(sel);
    if (
  found.length > 0 &&
  found.find("a").length > 0 &&
  found.find("img").length > 0
){
      console.log("🔍 ใช้ selector:", sel);
      return found;
    }
  }

  return [];
}

function extractBasicInfo($, el) {
  const titleSelectors = [
    ".entry-title",
    ".title",
    "h2",
    "h3"
  ];

  let title = "";
  for (const sel of titleSelectors) {
    title = $(el).find(sel).first().text().trim();
    if (title) break;
  }

  const link = $(el).find("a").attr("href");

  const image =
    $(el).find("img").attr("data-src") ||
    $(el).find("img").attr("src");

  return { title, link, image };
}

function autoDetectEpisodes($) {
  const selectors = [
    "ul#MVP li a",
    ".episode-list a",
    ".ep a",
    ".episodes a",
    ".mp-ep-btn" // ✅ เพิ่มอันนี้
  ];

  for (const sel of selectors) {
    const found = $(sel);
    if (found.length > 0) {
      console.log("🔍 ใช้ episode selector:", sel);
      return found;
    }
  }

  return [];
}

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await client.get(url);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log("🔁 retry:", url);
      await delay(1000);
    }
  }
}

async function fetchPlayerFromAjax(epId) {
  try {
    const url = "https://goseries4k.com/wp-admin/admin-ajax.php";

    const form = new URLSearchParams();
    form.append("action", "miru_load_player");
    form.append("id", epId);

    const { data } = await client.post(
      url,
      form.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        }
      }
    );

    const $ = cheerio.load(data);

    const iframe =
      $("iframe").attr("src") ||
      $("iframe").attr("data-src");

    return iframe || null;

  } catch (err) {
    console.log("❌ AJAX player fail:", epId);
    return null;
  }
}

// ==========================
// FILE SIZE CONTROL
// ==========================
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB


// ==========================
// MAIN
// ==========================
(async () => {

if (!fs.existsSync("data")) {
  fs.mkdirSync("data");
}

let fileIndex = 1;
let currentData = [];
let currentFilePath = `data/${cat.slug}_${fileIndex}.json`;
   
// โหลดข้อมูลเก่าเพื่อกันดึงซ้ำ
const oldMap = new Map();

// โหลดทุกไฟล์ที่เคย split ไว้
const files = fs.readdirSync("data")
  .filter(f => f.startsWith(cat.slug + "_"));

if (files.length > 0) {
  const numbers = files
    .map(f => parseInt(f.match(/_(\d+)\.json$/)?.[1] || 0))
    .filter(n => n > 0);

  if (numbers.length > 0) {
    fileIndex = Math.max(...numbers);
    currentFilePath = `data/${cat.slug}_${fileIndex}.json`;
  }
}

for (const file of files) {
  const data = JSON.parse(
    fs.readFileSync(`data/${file}`)
  );
  data.forEach(m => {
  if (!m.episodes) m.episodes = [];
  oldMap.set(m.link, m);
});
}
// เอาข้อมูลเก่าใส่ currentData ก่อนเริ่มโหลดเพิ่ม
for (const movie of oldMap.values()) {
  currentData.push(movie);
}

function saveWithSizeCheck() {

  const jsonString = JSON.stringify(currentData, null, 2);
  const size = Buffer.byteLength(jsonString, "utf8");

  if (size > MAX_FILE_SIZE) {

    const lastItem = currentData.pop();

    // 🔥 เขียนไฟล์ก่อนปิด
    fs.writeFileSync(
      currentFilePath,
      JSON.stringify(currentData, null, 2)
    );

    console.log("📦 ปิดไฟล์:", currentFilePath);

    fileIndex++;
    currentFilePath = `data/${cat.slug}_${fileIndex}.json`;

    currentData = [lastItem];

    // 🔥 เขียนไฟล์ใหม่ทันที
    fs.writeFileSync(
      currentFilePath,
      JSON.stringify(currentData, null, 2)
    );
  }
}

    console.log("📂 หมวด:", cat.name);

    for (let page = 1; page <= 999; page++) {

      console.log(`📄 หน้า ${page}`);

      try {

        const { data: catHtml } =
  await fetchWithRetry(`${cat.url}/page/${page}`);

        const $cat = cheerio.load(catHtml);
        const articles = autoDetectArticles($cat);

        if (articles.length === 0) {
          console.log("ไม่มีข้อมูลแล้ว หยุดที่หน้า", page);
          break;
        }

const articleArray = articles.toArray();

for (const el of articleArray) {
           
   const basic = extractBasicInfo($cat, el);

const title = basic.title;
if (!title) continue;
const link = normalizeUrl(basic.link);
const image = basic.image;

          if (!link) continue;

          let movie = oldMap.get(link);

          // ========================
          // ถ้าเป็นเรื่องใหม่
          // ========================
          if (!movie) {

            console.log("🆕 เรื่องใหม่:", title);

            movie = {
              title,
              link,
              image,
              episodes: []
            };
	    currentData.push(movie);
	    saveWithSizeCheck();
           

 oldMap.set(link, movie);
          }

          // ========================
                          // ดึงหน้า detail
          // ========================
          // ถ้าเป็นเรื่องเก่า ให้เช็คแค่ตอนล่าสุด

const { data: detailHtml } =
  await fetchWithRetry(link);

const $detail = cheerio.load(detailHtml);

const epElements =
  autoDetectEpisodes($detail).toArray();

if (!epElements || epElements.length === 0) {
  continue;
}

// ถ้ามีตอนใหม่ หรือเป็นเรื่องใหม่
for (let i = 0; i < epElements.length; i++) {

  const a = epElements[i];
  const $a = $detail(a);

  // ===============================
  // 🟢 mp-ep-btn (AJAX)
  // ===============================
  if ($a.hasClass("mp-ep-btn")) {

    const epId = $a.attr("data-id");
    const epName = $a.text().trim();
    if (!epId) continue;

    // 🔥 ถ้าเจอตอนที่มีอยู่แล้ว = หยุดทั้งเรื่องทันที
    if (movie.episodes.find(x => x.id === epId)) {
      console.log("   ⛔ เจอตอนซ้ำ หยุดเรื่องนี้");
      break;
    }

    console.log("   ↳ ดึงตอน (AJAX):", epName);

    const playerUrl = await fetchPlayerFromAjax(epId);

    movie.episodes.push({
      id: epId,
      name: epName,
      player: playerUrl
    });

    saveWithSizeCheck();
    await randomDelay();
    continue;
  }

  // ===============================
  // 🔵 แบบ href ปกติ
  // ===============================

  let epName =
    $a.find(".eptitle").text().trim() ||
    $a.text().trim();

  let epLink = normalizeUrl($a.attr("href"));
  if (!epLink) continue;

  // 🔥 ถ้าเจอตอนซ้ำ = หยุดทั้งเรื่อง
  if (movie.episodes.find(x => x.link === epLink)) {
    console.log("   ⛔ เจอตอนซ้ำ หยุดเรื่องนี้");
    break;
  }

  console.log("   ↳ ดึงตอน:", epName);

  const servers = await getEpisodeServers(epLink);

  movie.episodes.push({
    name: `ตอนที่ ${epName}`,
    link: epLink,
    servers
  });

  saveWithSizeCheck();
  await randomDelay();
}

       await randomDelay();
  
        }

      } catch (err) {
        console.log("⚠️ ข้ามหน้า", page);
      }

            
      await randomDelay(1500, 2500);
    }

    console.log("✅ เสร็จหมวด:", cat.name);
  
if (currentData.length > 0) {
  fs.writeFileSync(
    currentFilePath,
    JSON.stringify(currentData, null, 2)
  );
  console.log("💾 บันทึกไฟล์สุดท้าย:", currentFilePath);
}
})();
