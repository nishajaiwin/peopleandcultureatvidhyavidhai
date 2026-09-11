// Minimal .xlsx writer: stored-ZIP container, inline strings, four cell styles.
// styles: 0 default | 1 header | 2 wrapped body | 3 section band
const fs = require("fs");

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
}
function colName(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
function sheetXml(rows, cols) {
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<cols>' + cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + '</cols>'
    + '<sheetData>';
  rows.forEach((row, ri) => {
    x += `<row r="${ri + 1}">`;
    row.forEach((c, ci) => {
      const [v, st] = c;
      if (v === "" || v == null) return;
      x += `<c r="${colName(ci + 1)}${ri + 1}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    });
    x += "</row>";
  });
  return x + "</sheetData></worksheet>";
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="4">'
  + '<font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FF1B3A2F"/><name val="Calibri"/></font>'
  + '<font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  + '</fonts>'
  + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF3E7C4"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF16624F"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border/><border><left style="thin"><color rgb="FFD8CFB8"/></left><right style="thin"><color rgb="FFD8CFB8"/></right>'
  + '<top style="thin"><color rgb="FFD8CFB8"/></top><bottom style="thin"><color rgb="FFD8CFB8"/></bottom></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + '</cellXfs></styleSheet>';

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd]);
}

// sheets: [{ name, rows: [[ [value, style], ... ]], cols: [widths] }]
function writeWorkbook(outPath, sheets) {
  const files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>',
    "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
      + '</sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>',
    "xl/styles.xml": STYLES,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows, s.cols); });
  fs.writeFileSync(outPath, zip(files));
}

module.exports = { writeWorkbook };
