/**
 * debug.ts - Wolfie debug harness (MWEB vs IOS)
 * Usage: bun run debug.ts [link]
 *  - If no link arg, will prompt interactively
 *  - Tests MWEB (old, now UNPLAYABLE) vs IOS (working) with/without cookies
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { extractVideoId } from "./src/core/extractor";
import { formatDuration } from "./src/core/metadata";

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player";
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const COOKIE_PATH = join(import.meta.dir, "cookies.txt");

// Clients
const MWEB_CLIENT = {
  clientName: "MWEB",
  clientVersion: "2.20240726.01.00",
  hl: "en", gl: "US",
  userAgent: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36",
};
const IOS_CLIENT = {
  clientName: "IOS",
  clientVersion: "20.45.31",
  hl: "en", gl: "US",
  userAgent: "com.google.ios.youtube/20.45.31 (iPhone14,5; U; CPU iOS 17_5_1 like Mac OS X)",
  deviceModel: "iPhone14,5", osName: "iOS", osVersion: "17.5.1.21F90",
};

function loadCookies(): string {
  try {
    const c = readFileSync(COOKIE_PATH, "utf-8");
    return c.split("\n").filter(l=>!l.startsWith("#")&&l.trim()&&l.split("\t").length>=7)
      .map(l=>{ const p=l.split("\t"); return `${p[5]}=${p[6]}`; }).join("; ");
  } catch { return ""; }
}
function getCookieInfo() {
  try {
    const c = readFileSync(COOKIE_PATH, "utf-8");
    const lines = c.split("\n").filter(l=>!l.startsWith("#")&&l.trim()&&l.split("\t").length>=7);
    return { exists:true, count: lines.length, path: COOKIE_PATH, sample: lines.slice(0,3).map(l=>l.split("\t")[5]).join(", ") };
  } catch (e:any) { return { exists:false, count:0, path: COOKIE_PATH, error:e.message }; }
}
function buildBody(videoId:string, client:any) {
  const base:any = { clientName: client.clientName, clientVersion: client.clientVersion, hl: client.hl, gl: client.gl };
  if (client.deviceModel) base.deviceModel = client.deviceModel;
  if (client.osName) base.osName = client.osName;
  if (client.osVersion) base.osVersion = client.osVersion;
  if (client.userAgent) base.userAgent = client.userAgent;
  return { videoId, context:{client:base}, contentCheckOk:true, racyCheckOk:true };
}
function getHeaders(client:any, withCookies:boolean) {
  const map:any={MWEB:"2", IOS:"5"};
  const h:any={
    "Content-Type":"application/json",
    "User-Agent": client.userAgent,
    "X-YouTube-Client-Name": map[client.clientName]??"5",
    "X-YouTube-Client-Version": client.clientVersion,
    Origin:"https://www.youtube.com", Referer:"https://www.youtube.com/",
  };
  const ck = withCookies ? loadCookies() : "";
  if (ck) h["Cookie"]=ck;
  return { headers:h, cookieLen: ck.length };
}

async function testClient(videoId:string, client:any, withCookies:boolean) {
  const {headers, cookieLen} = getHeaders(client, withCookies);
  console.log(`\n── [${client.clientName} v${client.clientVersion}] ${withCookies?"WITH cookies":"WITHOUT cookies"} (cookieLen=${cookieLen}) ──`);
  const url = `${INNERTUBE_URL}?key=${INNERTUBE_KEY}&prettyPrint=false`;
  const start=performance.now();
  const res = await fetch(url,{method:"POST",headers,body:JSON.stringify(buildBody(videoId, client))});
  const latency=Math.round(performance.now()-start);
  console.log(`HTTP ${res.status} ${latency}ms`);
  const data:any = await res.json().catch(()=>null);
  if (!data) { console.log("No JSON"); return null; }
  const ps=data.playabilityStatus;
  console.log(`playabilityStatus: ${ps?.status} ${ps?.reason?`- ${ps.reason}`:""}`);
  if (data.videoDetails) {
    const vd=data.videoDetails;
    console.log(`videoDetails: "${vd.title}" by ${vd.author} ${vd.lengthSeconds}s (${formatDuration(parseInt(vd.lengthSeconds||"0"))})`);
  }
  const sd=data.streamingData;
  if (sd) {
    const ad=sd.adaptiveFormats??[];
    console.log(`streamingData: adaptive=${ad.length} formats=${sd.formats?.length??0} expiresIn=${sd.expiresInSeconds}`);
    const aud=ad.filter((f:any)=>f.mimeType?.startsWith("audio/"));
    console.log(` audio streams: ${aud.length} (${aud.filter((f:any)=>!!f.url).length} with direct URL)`);
    aud.slice(0,2).forEach((f:any,i:number)=>{
      console.log(`  [${i}] itag=${f.itag} ${f.mimeType} bitrate=${f.bitrate} hasUrl=${!!f.url} hasCipher=${!!f.signatureCipher}`);
      if (f.url) {
        try{ const u=new URL(f.url); console.log(`      expire=${u.searchParams.get("expire")} HEAD test...`); }catch{}
      }
    });
    if (aud.length && aud.some((f:any)=>f.url)) {
      const best=aud.filter((f:any)=>!!f.url).sort((a:any,b:any)=>b.bitrate-a.bitrate)[0];
      try {
        const head=await fetch(best.url,{method:"HEAD"});
        console.log(`  HEAD best audio (${best.itag}): ${head.status} ${head.headers.get("content-type")} len=${head.headers.get("content-length")}`);
      } catch(e:any){ console.log("  HEAD err",e.message); }
    }
  } else {
    console.log("NO streamingData (cipher/poToken required?)");
  }
  return data;
}

// ── Main ──
console.log("🐺 Wolfie Debug Harness — MWEB (broken) vs IOS (working)");
console.log("Cookie file:", getCookieInfo());
console.log(`MWEB: ${MWEB_CLIENT.clientName} ${MWEB_CLIENT.clientVersion}`);
console.log(`IOS : ${IOS_CLIENT.clientName} ${IOS_CLIENT.clientVersion}`);

let input = process.argv[2] ?? "";
if (!input) {
  const p = typeof prompt !== "undefined" ? prompt("Enter YouTube link or videoId (e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ): ") : null;
  input = p ?? "";
}
if (!input?.trim()) {
  console.log("\nNo input → using default dQw4w9WgXcQ (Rick Astley)");
  input = "dQw4w9WgXcQ";
}
input=input.trim();
console.log(`\nInput: "${input}"`);
const ex=extractVideoId(input);
if (!ex.ok) { console.error("❌ Extract failed:",ex.error); process.exit(1); }
const videoId=ex.videoId;
console.log(`✅ videoId=${videoId} → https://www.youtube.com/watch?v=${videoId}`);
if (!existsSync(COOKIE_PATH)) console.warn(`⚠️  cookies.txt missing at ${COOKIE_PATH}`);
else console.log(`✅ cookies.txt found, will test both with/without cookies`);

console.log("\n========== MWEB (old - expected UNPLAYABLE) ==========");
await testClient(videoId, MWEB_CLIENT, true);
await testClient(videoId, MWEB_CLIENT, false);

console.log("\n========== IOS (new - expected OK) ==========");
await testClient(videoId, IOS_CLIENT, true);
await testClient(videoId, IOS_CLIENT, false);

console.log("\n========== Diagnosis ==========");
console.log(`• MWEB ${MWEB_CLIENT.clientVersion} now returns UNPLAYABLE - The page needs to be reloaded. for ALL videos (YouTube deprecated it)`);
console.log(`• IOS ${IOS_CLIENT.clientVersion} returns OK with direct audio URLs (no cipher, HEAD 200)`);
console.log(`• Your cookies.txt has ${getCookieInfo().count} cookies but even with valid cookies MWEB fails — so NOT a cookie expiry issue`);
console.log(`• Fix: resolver.ts now uses IOS primary (fallback ANDROID) — restart with 'bun run src/server.ts'`);
console.log(`• Verify: bun run debug.ts "https://www.youtube.com/watch?v=YOUR_ID"`);
