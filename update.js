const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const categories = JSON.parse(fs.readFileSync("categories.json"));

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

    // ดึงหน้าหมวด หน้า 1
    const { data: catHtml } = await axios.get(`${cat.url}/page/1`);
    const $cat = cheerio.load(catHtml);

    const articles = $cat("article");

    for (let el of articles) {
      const title = $cat(el).find(".entry-title").text().trim();
      const link = $cat(el).find("a.post-thumbnail").attr("href");
      const img = $cat(el).find("img").attr("data-src");

      if (!link) continue;

      let movie = oldMap.get(link);

      // ถ้าเป็นเรื่องใหม่
      if (!movie) {
        movie = { title, link, image: img, episodes: [] };

        // ดึงรายละเอียดเรื่อง
        const { data: detailHtml } = await axios.get(link);
        const $detail = cheerio.load(detailHtml);

        $detail("a").each((i, a) => {
          const text = $detail(a).text().trim();
          const epUrl = $detail(a).attr("href");

          if (text.match(/ตอน/i) && epUrl) {
            movie.episodes.push({ name: text, link: epUrl, servers: [] });
          }
        });

        updated.unshift(movie);

      } else {
        // เรื่องเก่า → เช็คว่ามีตอนใหม่
        const { data: detailHtml } = await axios.get(link);
        const $detail = cheerio.load(detailHtml);

        let found = [];
        $detail("a").each((i, a) => {
          const text = $detail(a).text().trim();
          const epUrl = $detail(a).attr("href");
          if (text.match(/ตอน/i) && epUrl) found.push({ name: text, link: epUrl });
        });

        // ถ้ามีตอนใหม่เพิ่ม
        if (found.length > movie.episodes.length) {
          for (let ep of found) {
            if (!movie.episodes.find(x => x.link === ep.link)) {
              movie.episodes.push({ ...ep, servers: [] });
            }
          }
        }
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
  }
})();
