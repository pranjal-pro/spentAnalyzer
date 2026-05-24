import express from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPREADSHEET_ID = '19jRHgrf9cTfPYI5gHi_pYA1j62vTZ4BcdmUXLqYPWxc';
const KEY_PATH = path.join(__dirname, 'service-account.json');
const PORT = 3001;
const CACHE_MS = 60_000; // 1 minute

if (!fs.existsSync(KEY_PATH)) {
  console.error(`\n❌ Missing ${KEY_PATH}`);
  console.error('   Drop your NEW service-account JSON there before starting.\n');
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
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

  // Flatten into the {index_, row} shape data.js expects, prefixing each
  // tab with a banner row so the section walker can switch parsers.
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

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`📊 sheet server listening on http://localhost:${PORT}`);
});
