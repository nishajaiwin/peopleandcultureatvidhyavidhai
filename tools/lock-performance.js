// Sets the password for the Performance employee folders (Nisha and Karunya only).
// The Performance Review Policy itself is open to everyone. The page keeps a small sealed
// blob (AES-256-GCM, key from PBKDF2-SHA256, 310k iterations); the browser unlocks the
// folders only if the entered password decrypts it. The password is never stored here.
// Usage: node tools/lock-performance.js index.html <file holding the new password>
const fs = require("fs"), c = require("crypto");
const [file, pwFile] = process.argv.slice(2);
const pw = fs.readFileSync(pwFile, "utf8").trim();
let html = fs.readFileSync(file, "utf8");
const re = /(<script type="application\/json" id="pm-sealed">)[^<]*(<\/script>)/;
if (!re.test(html)) throw new Error("pm-sealed block not found");
const salt = c.randomBytes(16), iv = c.randomBytes(12), ITER = 310000;
const key = c.pbkdf2Sync(pw, salt, ITER, 32, "sha256");
const ci = c.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([ci.update("vv-performance-folders", "utf8"), ci.final(), ci.getAuthTag()]);
const blob = { v: 1, iter: ITER, salt: salt.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64") };
html = html.replace(re, (m, a, b) => a + JSON.stringify(blob) + b);
fs.writeFileSync(file, html);
console.log("folders password updated");
