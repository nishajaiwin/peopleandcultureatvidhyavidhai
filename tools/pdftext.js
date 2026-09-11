// Minimal PDF text extractor: indexes objects, resolves each page's fonts,
// decodes their /ToUnicode CMaps, and runs the content streams through them.
// Node stdlib only.
const fs = require("fs");
const zlib = require("zlib");

const pdfPath = process.argv[2];
const outPath = process.argv[3];

const buf = fs.readFileSync(pdfPath);
const lat = buf.toString("latin1");

/* ---------- object index ---------- */
const objs = new Map();
{
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(lat))) {
    const num = parseInt(m[1], 10);
    const bodyStart = m.index + m[0].length;
    let sIdx = lat.indexOf("stream", bodyStart);
    let eObj = lat.indexOf("endobj", bodyStart);
    let sStart = -1, sEnd = -1;
    if (sIdx !== -1 && (eObj === -1 || sIdx < eObj)) {
      let p = sIdx + 6;
      if (lat[p] === "\r") p++;
      if (lat[p] === "\n") p++;
      sStart = p;
      sEnd = lat.indexOf("endstream", p);
      eObj = lat.indexOf("endobj", sEnd === -1 ? p : sEnd);
    }
    const dict = lat.slice(bodyStart, sStart === -1 ? (eObj === -1 ? bodyStart : eObj) : sIdx);
    objs.set(num, { dict, sStart, sEnd });
  }
}

function inflate(num) {
  const o = objs.get(num);
  if (!o || o.sStart === -1 || o.sEnd === -1) return null;
  let end = o.sEnd;
  while (end > o.sStart && (lat[end - 1] === "\n" || lat[end - 1] === "\r")) end--;
  const slice = buf.slice(o.sStart, end);
  if (!/FlateDecode/.test(o.dict)) return slice.toString("latin1");
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
    try { return fn(slice).toString("latin1"); } catch (e) { /* try next */ }
  }
  return null;
}

function refIn(str, key) {
  const m = new RegExp("\\/" + key + "\\s+(\\d+)\\s+\\d+\\s+R").exec(str);
  return m ? parseInt(m[1], 10) : null;
}

/* ---------- ToUnicode CMaps ---------- */
function hexToStr(h) {
  let s = "";
  for (let i = 0; i + 3 < h.length + 3; i += 4) {
    const part = h.substr(i, 4);
    if (!part) break;
    s += String.fromCharCode(parseInt(part.padEnd(4, "0"), 16));
  }
  return s;
}

const cmapCache = new Map();
function getCMap(fontObjNum) {
  if (cmapCache.has(fontObjNum)) return cmapCache.get(fontObjNum);
  const fo = objs.get(fontObjNum);
  let result = null;
  if (fo) {
    const tu = refIn(fo.dict, "ToUnicode");
    if (tu !== null) {
      const txt = inflate(tu);
      if (txt) {
        const map = new Map();
        let codeLen = 1;
        const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(txt);
        if (cs) {
          const c = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/.exec(cs[1]);
          if (c) codeLen = Math.max(1, c[1].length / 2);
        }
        let m;
        const bc = /beginbfchar([\s\S]*?)endbfchar/g;
        while ((m = bc.exec(txt))) {
          const pr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g;
          let p;
          while ((p = pr.exec(m[1]))) {
            map.set(parseInt(p[1], 16), hexToStr(p[2]));
            codeLen = Math.max(codeLen, p[1].length / 2);
          }
        }
        const br = /beginbfrange([\s\S]*?)endbfrange/g;
        while ((m = br.exec(txt))) {
          const rr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([\s\S]*?)\])/g;
          let r;
          while ((r = rr.exec(m[1]))) {
            const lo = parseInt(r[1], 16), hi = parseInt(r[2], 16);
            codeLen = Math.max(codeLen, r[1].length / 2);
            if (r[3] !== undefined) {
              const units = [];
              for (let i = 0; i < r[3].length; i += 4) units.push(parseInt(r[3].substr(i, 4), 16));
              for (let c = lo; c <= hi && c - lo < 65536; c++) {
                const u = units.slice();
                u[u.length - 1] += (c - lo);
                map.set(c, String.fromCharCode.apply(null, u));
              }
            } else {
              const items = (r[4] || "").match(/<[0-9A-Fa-f]*>/g) || [];
              items.forEach((it, i) => map.set(lo + i, hexToStr(it.replace(/[<>]/g, ""))));
            }
          }
        }
        if (map.size) result = { map, codeLen };
      }
    }
  }
  cmapCache.set(fontObjNum, result);
  return result;
}

/* ---------- page walk ---------- */
function resolveDict(str, key) {
  // Returns the dictionary text for /Key, whether inline << >> or an indirect ref.
  const r = refIn(str, key);
  if (r !== null) { const o = objs.get(r); return o ? o.dict : null; }
  const i = str.indexOf("/" + key);
  if (i === -1) return null;
  const start = str.indexOf("<<", i);
  if (start === -1) return null;
  let depth = 0;
  for (let p = start; p < str.length - 1; p++) {
    if (str[p] === "<" && str[p + 1] === "<") { depth++; p++; }
    else if (str[p] === ">" && str[p + 1] === ">") { depth--; p++; if (!depth) return str.slice(start, p + 1); }
  }
  return null;
}

function pageResources(dict, depth) {
  if (depth > 8) return null;
  const res = resolveDict(dict, "Resources");
  if (res) return res;
  const parent = refIn(dict, "Parent");
  if (parent === null) return null;
  const po = objs.get(parent);
  return po ? pageResources(po.dict, depth + 1) : null;
}

function pdfStringBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out.push(s.charCodeAt(i) & 0xff); continue; }
    i++;
    const n = s[i];
    if (n === undefined) break;
    if (n === "n") out.push(10);
    else if (n === "r") out.push(13);
    else if (n === "t") out.push(9);
    else if (n === "b") out.push(8);
    else if (n === "f") out.push(12);
    else if (n === "(" || n === ")" || n === "\\") out.push(n.charCodeAt(0));
    else if (n >= "0" && n <= "7") {
      let o = n;
      while (o.length < 3 && s[i + 1] >= "0" && s[i + 1] <= "7") { i++; o += s[i]; }
      out.push(parseInt(o, 8) & 0xff);
    } else if (n === "\n" || n === "\r") { /* line continuation */ }
    else out.push(n.charCodeAt(0) & 0xff);
  }
  return out;
}

function decodeBytes(bytes, cm) {
  if (!cm) return bytes.map((b) => String.fromCharCode(b)).join("");
  let s = "";
  const L = cm.codeLen;
  for (let i = 0; i + L <= bytes.length; i += L) {
    let code = 0;
    for (let k = 0; k < L; k++) code = (code << 8) | bytes[i + k];
    const t = cm.map.get(code);
    s += (t === undefined ? "" : t);
  }
  return s;
}

function hexBytes(h) {
  const clean = h.replace(/\s+/g, "");
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.substr(i, 2), 16));
  if (clean.length % 2) out.push(parseInt(clean[clean.length - 1] + "0", 16));
  return out;
}

const TOK_SRC = /\/(?<fname>[^\s/<>\[\]()]+)\s+[-\d.]+\s+Tf|\[(?<arr>(?:\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]*>|[^\[\]])*)\]\s*TJ|\((?<lit>(?:\\[\s\S]|[^\\()])*)\)\s*(?:Tj|'|")|<(?<hex>[0-9A-Fa-f\s]*)>\s*Tj|\/(?<xname>[^\s/<>\[\]()]+)\s+Do|(?<tx>-?[\d.]+)\s+(?<ty>-?[\d.]+)\s+(?<td>Td|TD)|(?<tstar>T\*)/.source;
const ARR_SRC = /\((?<s>(?:\\[\s\S]|[^\\()])*)\)|<(?<h>[0-9A-Fa-f\s]*)>|(?<n>-?[\d.]+)/.source;

// This deck draws each page through a Form XObject, so the fonts live on the
// XObject's own /Resources. Recurse, carrying each level's font map with it.
function renderStream(content, resDict, depth) {
  if (depth > 6 || !content) return "";
  const fonts = new Map();
  const fontDict = resolveDict(resDict, "Font") || "";
  let fm; const fr = /\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g;
  while ((fm = fr.exec(fontDict))) fonts.set(fm[1], getCMap(parseInt(fm[2], 10)));

  const xobjs = new Map();
  const xoDict = resolveDict(resDict, "XObject") || "";
  let xm; const xr = /\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g;
  while ((xm = xr.exec(xoDict))) xobjs.set(xm[1], parseInt(xm[2], 10));

  const tok = new RegExp(TOK_SRC, "g");
  const arr = new RegExp(ARR_SRC, "g");
  let cm = null, out = "", m;
  while ((m = tok.exec(content))) {
    const g = m.groups;
    if (g.fname !== undefined) cm = fonts.get(g.fname) || null;
    else if (g.arr !== undefined) {
      arr.lastIndex = 0;
      let a;
      while ((a = arr.exec(g.arr))) {
        if (a.groups.s !== undefined) out += decodeBytes(pdfStringBytes(a.groups.s), cm);
        else if (a.groups.h !== undefined) out += decodeBytes(hexBytes(a.groups.h), cm);
        else if (a.groups.n !== undefined && parseFloat(a.groups.n) < -120) out += " ";
      }
    } else if (g.lit !== undefined) out += decodeBytes(pdfStringBytes(g.lit), cm);
    else if (g.hex !== undefined) out += decodeBytes(hexBytes(g.hex), cm);
    else if (g.xname !== undefined) {
      const on = xobjs.get(g.xname);
      if (on !== undefined) {
        const xo = objs.get(on);
        if (xo && /\/Subtype\s*\/Form/.test(xo.dict)) {
          out += renderStream(inflate(on), resolveDict(xo.dict, "Resources") || "", depth + 1);
        }
      }
    } else if (g.td !== undefined) {
      // Every glyph is placed with its own Td; only a vertical move is a real line break.
      if (Math.abs(parseFloat(g.ty)) > 0.01) out += "\n";
    } else if (g.tstar !== undefined) out += "\n";
  }
  return out;
}

const pages = [];
for (const [num, o] of objs) {
  if (!/\/Type\s*\/Page[^s]/.test(o.dict + " ")) continue;
  const resDict = pageResources(o.dict, 0) || "";

  let contentNums = [];
  const cRef = refIn(o.dict, "Contents");
  if (cRef !== null) contentNums = [cRef];
  else {
    const ca = /\/Contents\s*\[([^\]]*)\]/.exec(o.dict);
    if (ca) { let g, gr = /(\d+)\s+\d+\s+R/g; while ((g = gr.exec(ca[1]))) contentNums.push(parseInt(g[1], 10)); }
  }
  let content = "";
  for (const cn of contentNums) { const t = inflate(cn); if (t) content += t + "\n"; }
  if (!content) continue;

  pages.push({ num, text: renderStream(content, resDict, 0) });
}

let all = "";
pages.forEach((p, i) => {
  let t = p.text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  all += `\n\n========== PAGE ${i + 1} (obj ${p.num}) ==========\n` + t;
});
fs.writeFileSync(outPath, all, "utf8");
const letters = (all.match(/[A-Za-z]/g) || []).length;
console.log(`pages: ${pages.length}  chars: ${all.length}  letters: ${letters}`);
