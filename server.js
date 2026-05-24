import express from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '19jRHgrf9cTfPYI5gHi_pYA1j62vTZ4BcdmUXLqYPWxc';
const KEY_PATH = process.env.SERVICE_ACCOUNT_PATH || path.join(__dirname, 'service-account.json');
const PORT = process.env.PORT || 3001;
const CACHE_MS = 60_000;

if (!fs.existsSync(KEY_PATH)) {
  console.error(`\n❌ Missing ${KEY_PATH}`);
  console.error('   Drop your service-account JSON there before starting.\n');
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  // Full read-write scope. Service account must be added to the sheet as Editor.
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

let cache = { at: 0, data: null };

async function loadSheet() {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(title))',
  });
  const titles = meta.data.sheets.map(s => s.properties.title);

  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: titles,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const flat = [];
  let i = 0;
  batch.data.valueRanges.forEach((vr, idx) => {
    flat.push({ index_: i++, row: [titles[idx]] });
    (vr.values || []).forEach(r => flat.push({ index_: i++, row: r }));
    flat.push({ index_: i++, row: [] });
  });
  return { tabs: titles, rows: flat };
}

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/sheet', async (req, res) => {
  try {
    if (req.query.refresh !== '1' && cache.data && Date.now() - cache.at < CACHE_MS) {
      return res.json(cache.data);
    }
    const data = await loadSheet();
    cache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    console.error('Sheet fetch failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Append a row to the appropriate tab based on type.
 * Body: { type: 'debit'|'credit'|'invest', date, category, reason, amount }
 *
 * Layout assumed for each tab:
 *   debit  -> "Monthly Spent" : [Date, Category, Reason, Spent]
 *   credit -> "Credit"        : [Date, Month, Category, Reason, Amount]
 *   invest -> "Investments"   : [Date, Reason, Amount]
 *
 * Falls back to fuzzy tab-name matching if exact title isn't found.
 */
// 0 -> A, 1 -> B, ..., 25 -> Z, 26 -> AA
function colLetter(n) {
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/**
 * Insert `newRow` at the bottom of the named section in a tab.
 * Section header (e.g. "May 26", "Credit Table 26") is matched case-insensitively.
 * Returns the range that was written.
 */
async function insertIntoSection({ tab, sectionLabel, width, newRow }) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(sectionLabel);

  // -- (1) Try native Sheets Tables / NamedRanges first ----------------
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title),tables(name,range)),namedRanges(name,range)',
  });
  const tabBySheetId = new Map(meta.data.sheets.map(s => [s.properties.sheetId, s.properties.title]));

  let tableRange = null;
  let tableTab = null;
  for (const s of meta.data.sheets) {
    for (const t of (s.tables || [])) {
      if (norm(t.name) === target) {
        tableRange = t.range;
        tableTab = s.properties.title;
        break;
      }
    }
    if (tableRange) break;
  }
  if (!tableRange) {
    for (const n of (meta.data.namedRanges || [])) {
      if (norm(n.name) === target) {
        tableRange = n.range;
        tableTab = tabBySheetId.get(n.range.sheetId);
        break;
      }
    }
  }

  if (tableRange) {
    // Tables/NamedRanges range: { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }
    // endRowIndex is exclusive. Native Tables include the header row at the top
    // and may include a total/footer row at the bottom.
    const sheetId   = tableRange.sheetId;
    const startCol  = tableRange.startColumnIndex ?? 0;
    const startRow  = tableRange.startRowIndex ?? 0; // header row (0-indexed)
    const endRow    = tableRange.endRowIndex ?? (startRow + 1); // exclusive
    const endCol    = startCol + width - 1;

    // Read just the first column (Date) of the table body to find the last
    // row that has a real date entry. Footer/total rows have no date.
    const dateColLetter = colLetter(startCol);
    const dateGet = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tableTab}'!${dateColLetter}${startRow + 2}:${dateColLetter}${endRow}`,
    });
    const dateRows = dateGet.data.values || [];
    let lastDateOffset = -1; // 0-indexed within dateRows
    for (let i = dateRows.length - 1; i >= 0; i--) {
      const v = (dateRows[i] || [])[0];
      if (v !== '' && v !== null && v !== undefined) { lastDateOffset = i; break; }
    }
    // 1-indexed sheet row of the last data row, or just below header if empty
    const lastDataRow1 = lastDateOffset >= 0
      ? startRow + 2 + lastDateOffset            // 0-index header row → 1-index header → +offset
      : startRow + 1;                            // table is empty, write directly below header

    // Shift everything below lastDataRow1 down by one, creating a blank line
    // that sits BETWEEN the last data row and the footer.
    const insertAt0 = lastDataRow1; // 0-indexed row index where the blank gets inserted
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          insertDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: insertAt0,
              endIndex: insertAt0 + 1,
            },
            inheritFromBefore: true, // copy formatting from the data row above
          },
        }],
      },
    });

    const writeAt1 = lastDataRow1 + 1; // 1-indexed row where we'll write the new entry
    const range = `'${tableTab}'!${dateColLetter}${writeAt1}:${colLetter(endCol)}${writeAt1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });
    return range;
  }

  // -- (2) Fallback: text-based section header lookup (old behavior) ----
  const got = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tab}'`,
  });
  const values = got.data.values || [];

  let hr = -1, hc = -1;
  const candidates = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cellNorm = norm(row[c]);
      if (!cellNorm) continue;
      if (cellNorm === target) { hr = r; hc = c; break; }
      if (cellNorm.length < 40 && cellNorm.includes(target.slice(0, 3))) {
        candidates.push(String(row[c]).trim());
      }
    }
    if (hr !== -1) break;
  }
  if (hr === -1) {
    const hint = candidates.length
      ? ` Cells that contained "${sectionLabel.slice(0, 3)}": ${[...new Set(candidates)].slice(0, 6).join(' | ')}`
      : '';
    throw new Error(`Section "${sectionLabel}" not found in tab "${tab}".${hint}`);
  }

  // hr     = section label row
  // hr + 1 = column-header row (Date | Category | Reason | ...)
  // hr + 2 = first data row. Walk down within the section's column band until
  // we hit a blank row or another section banner.
  let lastDataRow = hr + 1;
  for (let r = hr + 2; r < values.length; r++) {
    const slice = (values[r] || []).slice(hc, hc + width);
    const hasData = slice.some(v => v !== '' && v !== null && v !== undefined);
    if (hasData) { lastDataRow = r; continue; }
    break; // first empty row inside the section -> section ends
  }

  const writeRow = lastDataRow + 2; // 0-indexed + 1 for next row + 1 for 1-indexing
  const range = `'${tab}'!${colLetter(hc)}${writeRow}:${colLetter(hc + width - 1)}${writeRow}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [newRow] },
  });

  return range;
}

app.post('/api/sheet/append', async (req, res) => {
  try {
    const { type, date, category, reason, amount } = req.body || {};
    if (!type || !date || !amount) {
      return res.status(400).json({ error: 'type, date and amount are required' });
    }
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'sheets(properties(title))',
    });
    const titles = meta.data.sheets.map(s => s.properties.title);

    const matchTab = (...needles) =>
      titles.find(t => {
        const low = t.toLowerCase();
        if (low.includes('final')) return false;
        return needles.some(n => low.includes(n));
      });

    const d = new Date(date);
    const yy = String(d.getFullYear()).slice(2);
    const monthFull = d.toLocaleDateString('en-US', { month: 'long' }); // "April", "May"
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const monthStr = d.toLocaleDateString('en-US', { month: '2-digit', year: '2-digit' }).replace('/', "'");

    let tab, sectionLabel, width, row;
    if (type === 'debit') {
      tab          = matchTab('monthly spent');
      sectionLabel = `${monthFull} ${yy}`;    // e.g. "April 26", "May 26"
      width        = 4;
      row          = [dateStr, category || 'Miscellaneous', reason || '---', Number(amount)];
    } else if (type === 'credit') {
      tab          = matchTab('credit');
      sectionLabel = `Credit Table ${yy}`;    // e.g. "Credit Table 26"
      width        = 5;
      row          = [dateStr, monthStr, category || 'Miscellaneous', reason || '---', Number(amount)];
    } else if (type === 'invest') {
      tab          = matchTab('investment', 'invest');
      sectionLabel = `Investments ${yy}`;     // e.g. "Investments 26"
      width        = 3;
      row          = [dateStr, reason || 'Investment', Number(amount)];
    } else {
      return res.status(400).json({ error: `unknown type "${type}"` });
    }

    if (!tab) {
      return res.status(404).json({ error: `No tab matched for type "${type}". Tabs: ${titles.join(', ')}` });
    }

    console.log(`📝 ${type} -> tab="${tab}" section="${sectionLabel}" row=`, row);
    const range = await insertIntoSection({ tab, sectionLabel, width, newRow: row });

    cache = { at: 0, data: null };
    res.json({ ok: true, tab, section: sectionLabel, range, row });
  } catch (err) {
    console.error('Append failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Production: serve the built React app from dist/ so a single process
// runs everything. `npm run build && NODE_ENV=production node server.js`
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
  }
}

app.listen(PORT, () => {
  console.log(`📊 sheet server listening on http://localhost:${PORT}`);
});
