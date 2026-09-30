# People & Culture — Vidhya Vidhai Foundation

An internal People & Culture dashboard: talent acquisition (with a browser-local
applicant tracker), onboarding, rewards, performance, learning, policies and resources.

Content for the policy library and the rewards tables is summarised from the
Team Handbook. The handbook remains the authority where the two differ.

The whole site is a single self-contained `index.html` — no build step, no
dependencies. Edit it and push; GitHub Pages redeploys automatically.

The talent pool is not on this site. The **Talent pool** option in the ATS tabs
opens the shared, signed-in pool on claude.ai (https://claude.ai/artifact/TaZcH3X5RpgQqXava3pumd),
so applicant data never sits on this public page.

Applicant tracker and new-hires data are stored in each viewer's own browser (localStorage).
It is never uploaded and is not shared between people or devices.

## tools/

Utilities written while building this page. Node stdlib only, no dependencies.

| Script | What it does |
| --- | --- |
| `build.js` | Wraps the Claude artifact fragment in a full HTML document to produce `index.html`. |
| `pdftext.js` | Extracts text from a PDF, decoding per-font ToUnicode CMaps and recursing into Form XObjects. Used to read the Team Handbook. |
| `xlsx.js` | Dumps an unpacked .xlsx to readable rows. |
| `xlsxlib.js` | Writes a multi-sheet .xlsx (stored-ZIP, inline strings). |
| `lock-performance.js` | Seals the Performance Review Policy view with a password (AES-256-GCM, PBKDF2). `node tools/lock-performance.js index.html <file holding the password>`. The password is never stored in this repo. |

Usage: `node tools/pdftext.js input.pdf output.txt`
