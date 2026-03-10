const axios = require("axios")
const cheerio = require("cheerio")

async function run(){

const url="https://anime-good.com/watch/one-piece-season-21-season-21-ep-1090-subth/"

console.log("OPEN",url)

const res = await axios.get(url,{
headers:{
"User-Agent":"Mozilla/5.0"
}
})

const $ = cheerio.load(res.data)

const iframe = $(".mp-s-sl").first().attr("data-id")

console.log("IFRAME",iframe)

}

run()