// The artifact file is a fragment: claude.ai wraps it in a document skeleton.
// For static hosting we supply that skeleton ourselves — including the
// [hidden] rule the view switcher depends on.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(process.argv[2], "utf8");
const outDir = process.argv[3];

const cut = src.indexOf("</style>");
if (cut === -1) { console.error("no </style> found"); process.exit(1); }
const headBits = src.slice(0, cut + "</style>".length);
const bodyBits = src.slice(cut + "</style>".length);

const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="People &amp; Culture at Vidhya Vidhai Foundation — talent acquisition, onboarding, rewards, performance, learning, policies and resources.">
<style>
  :root{color-scheme:light}
  body{margin:0}
  img{max-width:100%}
  [hidden]{display:none!important}
</style>
${headBits}
</head>
<body>
${bodyBits}
</body>
</html>
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), doc, "utf8");
console.log("index.html written:", Math.round(Buffer.byteLength(doc) / 1024) + " KB");
