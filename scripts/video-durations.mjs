#!/usr/bin/env node
// Reads the real length of each Google Drive recording in index.html by fetching only the
// MP4 header boxes with HTTP Range requests (no full download), and prints it next to the
// `duration` currently written in RECORDINGS.
//
// Usage: node scripts/video-durations.mjs          (report only)
//        node scripts/video-durations.mjs --write  (update `duration:` in index.html)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const INDEX_HTML = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html");
const WRITE = process.argv.includes("--write");

async function range(id, start, end) {
  const url = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error("HTTP " + res.status);
  const total = +(/\/(\d+)$/.exec(res.headers.get("content-range") || "") || [])[1] || 0;
  return { buf: Buffer.from(await res.arrayBuffer()), total };
}

function mvhd(moov) {
  const i = moov.indexOf("mvhd");
  if (i < 0) return null;
  const v = moov[i + 4];
  if (v === 1) {
    const timescale = moov.readUInt32BE(i + 4 + 4 + 16);
    const duration = Number(moov.readBigUInt64BE(i + 4 + 4 + 20));
    return duration / timescale;
  }
  const timescale = moov.readUInt32BE(i + 4 + 4 + 8);
  const duration = moov.readUInt32BE(i + 4 + 4 + 12);
  return duration / timescale;
}

async function durationOf(id) {
  let off = 0, total = Infinity;
  while (off < total) {
    const { buf, total: t } = await range(id, off, off + 15);
    if (t) total = t;
    if (buf.length < 8) break;
    let size = buf.readUInt32BE(0);
    const type = buf.toString("latin1", 4, 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(8));
    if (size === 0) size = total - off;
    if (type === "moov") {
      const { buf: moov } = await range(id, off, off + Math.min(size, 8_000_000) - 1);
      return mvhd(moov);
    }
    if (size < 8) break;
    off += size;
  }
  return null;
}

const fmt = (s) => {
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
};

let html = readFileSync(INDEX_HTML, "utf8");
const re = /\{\s*date:"([^"]+)"[^\n]*\n\s*lecture:"([^"]+)", duration:"([^"]+)"[^\n]*?url:"https:\/\/drive\.google\.com\/file\/d\/([\w-]+)\//g;
const rows = [...html.matchAll(re)];
let changed = 0;
for (const m of rows) {
  const [full, date, lecture, cur, id] = m;
  try {
    const secs = await durationOf(id);
    if (secs == null) { console.log(`${date} ${lecture}: could not read length (${id})`); continue; }
    const real = fmt(secs);
    console.log(`${date} ${lecture}: listed ${cur}  actual ${real}${real === cur ? "" : "  <-- differs"}`);
    if (WRITE && real !== cur) {
      html = html.replace(full, full.replace(`duration:"${cur}"`, `duration:"${real}"`));
      changed++;
    }
  } catch (e) {
    console.log(`${date} ${lecture}: failed (${e.message})`);
  }
}
if (WRITE && changed) { writeFileSync(INDEX_HTML, html); console.log(`Updated ${changed} entries.`); }
