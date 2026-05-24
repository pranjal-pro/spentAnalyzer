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
      titles.find(t => needles.some(n => t.toLowerCase().includes(n)));

    let tab, row;
    const dateStr = new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const monthStr = new Date(date).toLocaleDateString('en-US', { month: '2-digit', year: '2-digit' }).replace('/', "'");

    if (type === 'debit') {
      tab = matchTab('monthly spent', 'spent');
      row = [dateStr, category || 'Miscellaneous', reason || '---', Number(amount)];
    } else if (type === 'credit') {
      tab = matchTab('credit');
      row = [dateStr, monthStr, category || 'Miscellaneous', reason || '---', Number(amount)];
    } else if (type === 'invest') {
      tab = matchTab('investment', 'invest');
      row = [dateStr, reason || 'Investment', Number(amount)];
    } else {
      return res.status(400).json({ error: `unknown type "${type}"` });
    }

    if (!tab) {
      return res.status(404).json({ error: `No tab matched for type "${type}". Tabs: ${titles.join(', ')}` });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tab}'!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    // bust cache so the next GET returns fresh
    cache = { at: 0, data: null };
    res.json({ ok: true, tab, row });
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
