// Encrypts the Performance Review Policy view of the P&C page with a password.
// AES-256-GCM, key from PBKDF2-SHA256 (310k iterations). The browser decrypts with WebCrypto.
const fs = require("fs"), c = require("crypto");
const [file, pwFile] = process.argv.slice(2);
const pw = fs.readFileSync(pwFile, "utf8").trim();
let html = fs.readFileSync(file, "utf8");
const start = html.indexOf('<div class="page wide" id="view-performance" hidden>');
const hdrEnd = html.indexOf("</header>", start) + "</header>".length;
const foot = html.indexOf("<footer>", hdrEnd);
if (start < 0 || foot < 0) throw new Error("markers not found");
const plain = html.slice(hdrEnd, foot);
if (plain.includes("pm-lock")) throw new Error("already locked");
const salt = c.randomBytes(16), iv = c.randomBytes(12), ITER = 310000;
const key = c.pbkdf2Sync(pw, salt, ITER, 32, "sha256");
const ci = c.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([ci.update(plain, "utf8"), ci.final(), ci.getAuthTag()]);
const blob = { v: 1, iter: ITER, salt: salt.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64") };
const lock = `
  <section class="pm-lock" id="pm-lock">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke-linecap="round"/></svg>
    <h2>For HR leads only</h2>
    <p>The Performance Review Policy is locked. Enter the People &amp; Culture password to open it.</p>
    <form id="pm-form" autocomplete="off">
      <label for="pm-pw" class="pm-sr">Password</label>
      <input id="pm-pw" type="password" placeholder="Password" required>
      <button class="open-ats" type="submit">Unlock</button>
    </form>
    <p class="pm-err" id="pm-err" role="alert" hidden>That password did not work. Ask Karunya.</p>
  </section>
  <div id="pm-content"></div>
  <script type="application/json" id="pm-sealed">${JSON.stringify(blob)}</script>
`;
html = html.slice(0, hdrEnd) + lock + html.slice(foot);
const css = `
  /* Performance Review Policy lock */
  .pm-lock{max-width:440px;margin:48px auto;padding:32px 28px;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);text-align:center}
  .pm-lock svg{width:34px;height:34px;color:var(--accent)}
  .pm-lock h2{font-family:var(--display);font-weight:500;font-size:1.5rem;margin:10px 0 6px}
  .pm-lock p{color:var(--ink-soft);margin:0 0 18px}
  .pm-lock form{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
  .pm-lock input{flex:1 1 200px;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink)}
  .pm-lock .pm-err{color:#A33A2A;margin:14px 0 0}
  .pm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .card .lock-tag{font-size:.78em;margin-left:4px}
`;
html = html.replace("  /* Performance Review Policy */", css + "  /* Performance Review Policy */");
const js = `
<script>
/* Performance Review Policy lock: decrypts the sealed section in the browser. */
(function () {
  var sealed = JSON.parse(document.getElementById("pm-sealed").textContent);
  var lock = document.getElementById("pm-lock"), out = document.getElementById("pm-content");
  var err = document.getElementById("pm-err"), input = document.getElementById("pm-pw");
  function b64(s) { return Uint8Array.from(atob(s), function (ch) { return ch.charCodeAt(0); }); }
  function open(pw) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64(sealed.salt), iterations: sealed.iter },
        base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    }).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(sealed.iv) }, key, b64(sealed.ct));
    }).then(function (buf) {
      out.innerHTML = new TextDecoder().decode(buf);
      lock.hidden = true;
      try { sessionStorage.setItem("pm-pw", pw); } catch (e) {}
    });
  }
  document.getElementById("pm-form").addEventListener("submit", function (e) {
    e.preventDefault();
    err.hidden = true;
    open(input.value).catch(function () { err.hidden = false; input.select(); });
  });
  try { var saved = sessionStorage.getItem("pm-pw"); if (saved) open(saved).catch(function () {}); } catch (e) {}
})();
</script>
`;
html = html.replace(/<\/body>/i, js + "</body>");
// mark the card as locked
html = html.replace(/(data-goto="performance">\s*Performance Review Policy)/, '$1 <span class="lock-tag" aria-label="locked">&#128274;</span>');
fs.writeFileSync(file, html);
console.log("locked", plain.length, "chars");
