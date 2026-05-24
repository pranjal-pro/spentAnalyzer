# spentAnalyzer

Personal finance dashboard backed by a Google Sheet. Reads month-summary, granular spends, credits, and investments — surfaces them as KPIs, a multi-series growth chart, capital allocation, category mix, 90-day spend heatmap, and a forensic ledger drawer. Writes new entries straight back into the right table inside the sheet.

![logo](./public/logo.svg)

## Stack
- **Frontend**: Vite + React + Tailwind + d3 + lucide-react
- **Backend**: Express + `googleapis` (service-account auth)
- **Source of truth**: a single Google Sheet with tabs `Final Spent`, `Monthly Spent`, `Credit`, `Investments`

## One-time setup

1. **Service account** — In Google Cloud Console create a service account, enable Sheets API, generate a JSON key. Save it as `service-account.json` in the project root. It is gitignored.
2. **Share the sheet** — On the Google Sheet, click **Share** and add the service account's `client_email` as **Editor**.
3. **Env vars** — Copy `.env.example` to `.env` and fill in:
   ```
   SPREADSHEET_ID=<your sheet id>
   SERVICE_ACCOUNT_PATH=./service-account.json
   PORT=3001
   # Production-only: lock the deployment behind a browser login
   AUTH_USER=
   AUTH_PASS=
   ```

## Run

```bash
npm install
npm run dev
```

- Vite dev server at <http://localhost:5173>
- API server at <http://localhost:3001>

Vite proxies `/api/*` to the backend.

## Production build (single-process)

```bash
npm run build
NODE_ENV=production node server.js
```

Serves the built frontend AND the API on a single port. Set `AUTH_USER` + `AUTH_PASS` to gate the whole app behind HTTP Basic Auth — recommended any time the deploy is publicly reachable.

## Sheet layout assumed

| Tab | Sections | Row shape |
| --- | --- | --- |
| `Final Spent` | one summary table | `Months · Month Start · Total Expense · Total Invest · Credited · Balance` |
| `Monthly Spent` | one per month — table named `May 26`, `April 26`, etc. | `Date · Category · Reason · Spent` |
| `Credit` | one per year — `Credit Table 26` | `Date · Month · Category · Reason · Amount` |
| `Investments` | one per year — `Investments 26` | `Date · Reason · Amount` |

Section tables should be created as Sheets **Tables** (or Named Ranges). The append endpoint locates them via `spreadsheets.tables` metadata, inserts a row above any footer/total row, and inherits the formatting from the row above.

## Features

- Light / dark mode toggle, persisted in `localStorage`.
- Privacy / presentation mode — blurs every sheet value so you can record demos safely.
- Three independent time-range pickers (Growth Trajectory, Capital Allocation, Category Mix).
- Yearly / Monthly view in the Financial Ledger, with per-month drawer (Performance Breakdown + searchable Transaction Audit Log).
- Add Log dialog — two-step picker (Credit / Debit / Invest) with fixed category enums; entries POST to the right tab and section.
- 90-day spend heatmap.
- Recent Transactions feed with type filter + search.

## Files

| Path | Purpose |
| --- | --- |
| `server.js` | Express + Sheets API + Basic Auth |
| `src/data.jsx` | Main React app |
| `src/Root.jsx` | Fetch / loading / error shell |
| `src/index.css` | Tailwind + theme overrides + ambient backdrop |
| `public/logo.svg` | Brand mark / favicon |

## Notes

- Do not commit `service-account.json`, `.env`, or `node_modules/` — `.gitignore` already excludes them.
- The default `SPREADSHEET_ID` in `.env.example` points at the author's sheet; replace it with yours.
- Basic Auth credentials travel base64-encoded — only deploy behind HTTPS.
