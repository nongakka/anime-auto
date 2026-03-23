const axios = require("axios")
const fs = require("fs")

const API = "https://liveplayback.net/api/channels"

const LOGO = "https://liveplayback.net/uploads/"

const CDN = [

"https://ec2.stream.liveplayback.net/dookeela/",

  
]

async function run(){

console.log("FETCH CHANNELS")

const res = await axios.get(API,{
headers:{
"user-agent":"Mozilla/5.0"
}
})

const channels = res.data

let json = { channels: [] }

let m3u = "#EXTM3U\n\n"

for(const ch of channels){

if(!ch.channel) continue

const id = ch.channel
const name = ch.name

const logo = ch.thumbnail_path
? LOGO + ch.thumbnail_path
: ""

const group =
ch.category_info?.name_th ||
ch.category_info?.name ||
"Live TV"

const streams = CDN.map(c => `${c}${id}/playlist.m3u8`)

json.channels.push({
id,
name,
logo,
poster: logo,
group,
streams
})

/* ---------- M3U ---------- */

const stream = streams[0]

m3u += `#EXTINF:-1 tvg-id="${id}" tvg-name="${name}" tvg-logo="${logo}" group-title="${group}",${name}\n`
m3u += `${stream}\n\n`

}

/* ---------- SAVE FILES ---------- */

fs.writeFileSync("playlist.json",JSON.stringify(json,null,2))

fs.writeFileSync("playlist.m3u",m3u)

console.log("CHANNELS:",json.channels.length)
console.log("DONE")

}

run()
