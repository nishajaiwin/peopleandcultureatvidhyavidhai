# People & Culture — Vidhya Vidhai Foundation

An internal People & Culture dashboard: talent acquisition (with a browser-local
applicant tracker), onboarding, rewards, performance, learning, policies and resources.

Content for the policy library and the rewards tables is summarised from the
Team Handbook. The handbook remains the authority where the two differ.

The whole site is a single self-contained `index.html` — no build step, no
dependencies. Edit it and push; GitHub Pages redeploys automatically.

Applicant tracker data is stored in each viewer's own browser (localStorage).
It is never uploaded and is not shared between people or devices.

## tools/

Utilities written while building this page. Node stdlib only, no dependencies.

| Script | What it does |
| --- | --- |
| `build.js` | Wraps the Claude artifact fragment in a full HTML document to produce `index.html`. |
| `pdftext.js` | Extracts text from a PDF, decoding per-font ToUnicode CMaps and recursing into Form XObjects. Used to read the Team Handbook. |
| `xlsx.js` | Dumps an unpacked .xlsx to readable rows. |
| `xlsxlib.js` | Writes a multi-sheet .xlsx (stored-ZIP, inline strings). |

Usage: `node tools/pdftext.js input.pdf output.txt`
