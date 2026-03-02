const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const categories = JSON.parse(fs.readFileSync("categories.json"));

// ตั้งค่าป้องกันโดนบล็อก
const client = axios.create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "th-TH,th;q=0.9"
  },
  timeout: 20000
});

const delay = (ms) => new Promise(r => setTimeout(r, ms));

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

(async () => {

  for (const cat of categories) {

    const filePath = `data/${cat.slug}.json`;

    let oldData = [];
    if (fs.existsSync(filePath)) {
      oldData = JSON.parse(fs.readFileSync(filePath));
    }

    const oldMap = new Map();
    oldData.forEach(m => oldMap.set(m.link, m));

    let updated = [...oldData];

    console.log("📂 หมวด:", cat.name);

    // 🔥 ไล่ 1 - 100 หน้า
    for (let page = 1; page <= 100; page++) {

      console.log(`📄 หน้า ${page}`);

      try {

        const { data: catHtml } =
          await client.get(`${cat.url}/page/${page}`);

        const $cat = cheerio.load(catHtml);
        const articles = $cat("article");

        if (articles.length === 0) {
          console.log("ไม่มีข้อมูลแล้ว หยุดที่หน้า", page);
          break;
        }

        for (let el of articles) {

          const title = $cat(el).find(".entry-title").text().trim();
          const link = $cat(el).find("a.post-thumbnail").attr("href");
          const image =
            $cat(el).find("img").attr("data-src") ||
            $cat(el).find("img").attr("src");

          if (!link) continue;

          let movie = oldMap.get(link);

          // ========================
          // 🔵 เรื่องใหม่
          // ========================
          if (!movie) {

            console.log("🆕 เรื่องใหม่:", title);

            movie = {
              title,
              link,
              image,
              episodes: []
            };

            const { data: detailHtml } = await client.get(link);
            const $detail = cheerio.load(detailHtml);

            const episodeLinks = [];

            $detail("ul#MVP li.mvp a.ep-a-link").each((i, a) => {

              const epName =
                $detail(a).find(".eptitle").text().trim();
              const epLink =
                $detail(a).attr("href");

              episodeLinks.push({
                name: `ตอนที่ ${epName}`,
                link: epLink
              });
            });

            for (let ep of episodeLinks) {

              console.log("   ↳ ดึงตอน:", ep.name);

              const servers =
                await getEpisodeServers(ep.link);

              movie.episodes.push({
                ...ep,
                servers
              });

              await delay(700);
            }

            updated.unshift(movie);
          }

          // ========================
          // 🔵 เรื่องเก่า → เช็คตอนใหม่
          // ========================
          else {

            const { data: detailHtml } =
              await client.get(link);

            const $detail = cheerio.load(detailHtml);

            $detail("ul#MVP li.mvp a.ep-a-link")
              .each(async (i, a) => {

                const epName =
                  $detail(a).find(".eptitle").text().trim();

                const epLink =
                  $detail(a).attr("href");

                if (!movie.episodes.find(x => x.link === epLink)) {

                  console.log("🆕 ตอนใหม่:", title, "-", epName);

                  const servers =
                    await getEpisodeServers(epLink);

                  movie.episodes.push({
                    name: `ตอนที่ ${epName}`,
                    link: epLink,
                    servers
                  });

                  await delay(700);
                }
              });
          }

          await delay(800);
        }

      } catch (err) {
        console.log("⚠️ ข้ามหน้า", page);
      }

      await delay(1500);
    }

    fs.writeFileSync(
      filePath,
      JSON.stringify(updated, null, 2)
    );

    console.log("✅ เสร็จหมวด:", cat.name);
  }

  console.log("🎉 เสร็จทั้งหมด");

})();
