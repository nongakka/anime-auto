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

    console.log("กำลังดึงหมวด:", cat.name);

    const { data: catHtml } = await axios.get(`${cat.url}/page/1`);
    const $cat = cheerio.load(catHtml);

    const articles = $cat("article");

    for (let el of articles) {

      const title = $cat(el).find(".entry-title").text().trim();
      const link = $cat(el).find("a.post-thumbnail").attr("href");
      const image =
        $cat(el).find("img").attr("data-src") ||
        $cat(el).find("img").attr("src");

      if (!link) continue;

      let movie = oldMap.get(link);

      // 🔵 ถ้าเป็นเรื่องใหม่
      if (!movie) {

        console.log("เรื่องใหม่:", title);

        movie = {
          title,
          link,
          image,
          episodes: []
        };

        const { data: detailHtml } = await axios.get(link);
        const $detail = cheerio.load(detailHtml);

        // ดึงตอนทั้งหมดจาก ul#MVP
        $detail("ul#MVP li.mvp a.ep-a-link").each((i, a) => {

          const epName = $detail(a).find(".eptitle").text().trim();
          const epLink = $detail(a).attr("href");

          movie.episodes.push({
            name: `ตอนที่ ${epName}`,
            link: epLink,
            servers: []
          });
        });

        updated.unshift(movie);

      } else {

        // 🔵 เรื่องเก่า → เช็คตอนใหม่
        const { data: detailHtml } = await axios.get(link);
        const $detail = cheerio.load(detailHtml);

        let foundEpisodes = [];

        $detail("ul#MVP li.mvp a.ep-a-link").each((i, a) => {

          const epName = $detail(a).find(".eptitle").text().trim();
          const epLink = $detail(a).attr("href");

          foundEpisodes.push({
            name: `ตอนที่ ${epName}`,
            link: epLink
          });
        });

        if (foundEpisodes.length > movie.episodes.length) {

          console.log("พบตอนใหม่:", title);

          for (let ep of foundEpisodes) {

            if (!movie.episodes.find(x => x.link === ep.link)) {

              movie.episodes.push({
                ...ep,
                servers: []
              });

              console.log("เพิ่ม:", ep.name);
            }
          }
        }
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
    console.log("อัปเดตเสร็จ:", cat.name);
  }

})();
