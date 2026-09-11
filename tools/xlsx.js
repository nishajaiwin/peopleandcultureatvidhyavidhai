// Dump an unpacked .xlsx to readable rows. Node stdlib only.
const fs = require("fs");
const path = require("path");

const base = process.argv[2];

function unesc(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

// shared strings
const shared = [];
const ssPath = path.join(base, "xl", "sharedStrings.xml");
if (fs.existsSync(ssPath)) {
  const xml = fs.readFileSync(ssPath, "utf8");
  const items = xml.match(/<si>[\s\S]*?<\/si>/g) || [];
  for (const si of items) {
    const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    shared.push(parts.map((p) => unesc(p.replace(/<t[^>]*>/, "").replace(/<\/t>/, ""))).join(""));
  }
}

// sheet name -> file
const wb = fs.readFileSync(path.join(base, "xl", "workbook.xml"), "utf8");
const rels = fs.readFileSync(path.join(base, "xl", "_rels", "workbook.xml.rels"), "utf8");
const relMap = {};
for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
const sheets = [];
for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  sheets.push({ name: unesc(m[1]), file: relMap[m[2]] });
}

function colNum(ref) {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

let out = "";
for (const sh of sheets) {
  const p = path.join(base, "xl", sh.file.replace(/^\/?xl\//, "").replace(/\//g, path.sep));
  if (!fs.existsSync(p)) { out += `\n### ${sh.name} — file missing\n`; continue; }
  const xml = fs.readFileSync(p, "utf8");
  out += `\n\n############ SHEET: ${sh.name} ############\n`;
  const rows = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
  let printed = 0;
  for (const row of rows) {
    const rn = (/<row[^>]*r="(\d+)"/.exec(row) || [])[1] || "?";
    const cells = row.match(/<c[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) || [];
    const vals = [];
    for (const c of cells) {
      const ref = (/r="([A-Z]+\d+)"/.exec(c) || [])[1] || "";
      const t = (/ t="([^"]+)"/.exec(c) || [])[1];
      let v = "";
      if (t === "inlineStr") {
        const its = c.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        v = its.map((x) => unesc(x.replace(/<t[^>]*>/, "").replace(/<\/t>/, ""))).join("");
      } else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(c);
        if (vm) v = t === "s" ? (shared[+vm[1]] ?? "") : unesc(vm[1]);
      }
      v = String(v).replace(/\s*\n\s*/g, " ~ ").trim();
      if (v !== "") vals.push({ col: colNum(ref), v });
    }
    if (!vals.length) continue;
    vals.sort((a, b) => a.col - b.col);
    out += `r${rn}: ` + vals.map((x) => x.v).join(" | ") + "\n";
    printed++;
    if (printed > 400) { out += "... (truncated)\n"; break; }
  }
}
fs.writeFileSync(process.argv[3], out, "utf8");
console.log("sheets:", sheets.map((s) => s.name).join(", "), "| chars:", out.length);
