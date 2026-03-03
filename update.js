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

function normalizeUrl(url) {
  return url?.replace(/\/+$/, "");
}

// ==========================
// ดึง server จากหน้า episode
// ==========================
async function getEpisodeServers(epUrl) {
  try {
    const { data } = await client.get(epUrl);
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
    ".anime-item"
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
    ".episodes a"
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

// ==========================
// MAIN
// ==========================
(async () => {

   const filePath = `data/${cat.slug}.json`;

    let oldData = [];
    if (fs.existsSync(filePath)) {
      oldData = JSON.parse(fs.readFileSync(filePath));
    }

    const oldMap = new Map();
    oldData.forEach(m => oldMap.set(m.link, m));

    let updated = [...oldData];

    console.log("📂 หมวด:", cat.name);

    for (let page = 1; page <= 1; page++) {

      console.log(`📄 หน้า ${page}`);

      try {

        const { data: catHtml } =
          await client.get(`${cat.url}/page/${page}`);

        const $cat = cheerio.load(catHtml);
        const articles = autoDetectArticles($cat);

        if (articles.length === 0) {
          console.log("ไม่มีข้อมูลแล้ว หยุดที่หน้า", page);
          break;
        }

        for (let el of articles) {

          const basic =
  extractBasicInfo($cat, el);

const title = basic.title;
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

            updated.unshift(movie);
            oldMap.set(link, movie);
          }

          // ========================
          // ดึงหน้า detail
          // ========================
          const { data: detailHtml } =
            await client.get(link);

          const $detail = cheerio.load(detailHtml);

          const epElements =
  autoDetectEpisodes($detail);

          for (let i = 0; i < epElements.length; i++) {

            const a = epElements[i];

            let epName =
  $detail(a).find(".eptitle").text().trim();


if (!epName) {
  epName = $detail(a).text().trim();
}

            let epLink = normalizeUrl($detail(a).attr("href"));
if (!epLink) continue;

            if (!movie.episodes.find(x => x.link === epLink)) {

              console.log("   ↳ ดึงตอน:", epName);

              const servers =
                await getEpisodeServers(epLink);

              movie.episodes.push({
                name: `ตอนที่ ${epName}`,
                link: epLink,
                servers
              });

              await delay(700);
            }
          }

          await delay(800);
        }

      } catch (err) {
        console.log("⚠️ ข้ามหน้า", page);
      }

      // 💾 บันทึกทุกหน้า ป้องกันข้อมูลหาย
      fs.writeFileSync(
        filePath,
        JSON.stringify(updated, null, 2)
      );

      await delay(1500);
    }

    console.log("✅ เสร็จหมวด:", cat.name);
  
  console.log("🎉 เสร็จทั้งหมด");

})();
