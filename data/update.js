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

    let newMovies = [];

    const { data } = await axios.get(`${cat.url}/page/1`);
    const $ = cheerio.load(data);

    const articles = $("article");

    for (let el of articles) {

      const title = $(el).find(".entry-title").text().trim();
      const link = $(el).find("a.post-thumbnail").attr("href");
      const img = $(el).find("img").attr("data-src");

      if (!link) continue;

      if (!oldMap.has(link)) {

        const detailRes = await axios.get(link);
        const $$ = cheerio.load(detailRes.data);

        let episodes = [];

        $$("a").each((i, a) => {
          const text = $$(a).text().trim();
          const epLink = $$(a).attr("href");

          if (text.includes("ตอนที่")) {
            episodes.push({ name: text, link: epLink });
          }
        });

        newMovies.push({
          title,
          link,
          image: img,
          episodes
        });

      } else {

        const existingMovie = oldMap.get(link);

        const detailRes = await axios.get(link);
        const $$ = cheerio.load(detailRes.data);

        let currentEpisodes = [];

        $$("a").each((i, a) => {
          const text = $$(a).text().trim();
          const epLink = $$(a).attr("href");

          if (text.includes("ตอนที่")) {
            currentEpisodes.push({ name: text, link: epLink });
          }
        });

        if (currentEpisodes.length > existingMovie.episodes.length) {
          existingMovie.episodes = currentEpisodes;
        } else {
          break;
        }
      }
    }

    const finalData = [...newMovies, ...oldData];

    fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
  }

})();
