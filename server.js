const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const md5 = require('md5');

const app = express();
const PORT = process.env.PORT || 3001;

const PP_PARTNER_ID = process.env.PP_PARTNER_ID || '44765';
const PP_API_TOKEN  = process.env.PP_API_TOKEN  || 'bYwJH19FHjdmEqaPUbnP';
const PP_API_BASE   = 'https://affiliate.pocketoption.com/api/user-info';

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'crm.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type   TEXT NOT NULL,
    trader_id    TEXT,
    click_id     TEXT,
    site_id      TEXT,
    cid          TEXT,
    ac           TEXT,
    sub_id1      TEXT,
    sub_id2      TEXT,
    sub_id3      TEXT,
    sub_id4      TEXT,
    sub_id5      TEXT,
    country      TEXT,
    promo        TEXT,
    device_type  TEXT,
    os_version   TEXT,
    browser      TEXT,
    link_type    TEXT,
    visitor_id   TEXT,
    amount       REAL DEFAULT 0,
    date_time    TEXT,
    raw_payload  TEXT,
    received_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS traders (
    trader_id     TEXT PRIMARY KEY,
    country       TEXT,
    device_type   TEXT,
    browser       TEXT,
    os_version    TEXT,
    cid           TEXT,
    ac            TEXT,
    sub_id1       TEXT,
    promo         TEXT,
    site_id       TEXT,
    link_type     TEXT,
    registered_at TEXT,
    api_ftd_amount     REAL,
    api_total_deposits REAL,
    api_real_balance   REAL,
    api_status         TEXT,
    api_last_sync      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_ev_type    ON events(event_type);
  CREATE INDEX IF NOT EXISTS idx_ev_trader  ON events(trader_id);
  CREATE INDEX IF NOT EXISTS idx_ev_date    ON events(received_at);
  CREATE INDEX IF NOT EXISTS idx_ev_cid     ON events(cid);
  CREATE INDEX IF NOT EXISTS idx_ev_country ON events(country);
`);

// ─── PP API HELPER ────────────────────────────────────────────────────────────
async function fetchTraderFromPP(traderId) {
  try {
    const hash = md5(`${traderId}:${PP_PARTNER_ID}:${PP_API_TOKEN}`);
    const url  = `${PP_API_BASE}/${traderId}/${PP_PARTNER_ID}/${hash}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function syncTraderAPI(traderId) {
  const data = await fetchTraderFromPP(traderId);
  if (!data) return;
  db.prepare(`
    UPDATE traders SET
      api_ftd_amount     = ?,
      api_total_deposits = ?,
      api_real_balance   = ?,
      api_status         = ?,
      api_last_sync      = datetime('now')
    WHERE trader_id = ?
  `).run(data.ftd_amount ?? null, data.total_deposits ?? null, data.real_balance ?? null, data.status ?? null, traderId);
}

// ─── WEBHOOK (POST + GET) ─────────────────────────────────────────────────────
function processWebhook(p) {
  const eventType = p.event || 'unknown';
  const traderId  = p.trader_id || null;
  const amount    = parseFloat(p.sumdep || p.amount || 0) || 0;

  db.prepare(`
    INSERT INTO events (
      event_type, trader_id, click_id, site_id, cid, ac,
      sub_id1, sub_id2, sub_id3, sub_id4, sub_id5,
      country, promo, device_type, os_version, browser,
      link_type, visitor_id, amount, date_time, raw_payload
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    eventType, traderId,
    p.click_id||null, p.site_id||null, p.cid||null, p.ac||null,
    p.sub_id1||null, p.sub_id2||null, p.sub_id3||null, p.sub_id4||null, p.sub_id5||null,
    p.country||null, p.promo||null, p.device_type||null, p.os_version||null, p.browser||null,
    p.link_type||null, p.visitor_id||null,
    amount, p.date_time||null, JSON.stringify(p)
  );

  if (traderId && eventType === 'registration') {
    db.prepare(`
      INSERT OR IGNORE INTO traders
        (trader_id, country, device_type, browser, os_version, cid, ac, sub_id1, promo, site_id, link_type, registered_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(traderId, p.country||null, p.device_type||null, p.browser||null, p.os_version||null,
           p.cid||null, p.ac||null, p.sub_id1||null, p.promo||null, p.site_id||null, p.link_type||null,
           p.date_time||new Date().toISOString());
    syncTraderAPI(traderId).catch(() => {});
  }

  if (traderId && ['ftd','deposit','re-deposit'].includes(eventType)) {
    const exists = db.prepare('SELECT trader_id FROM traders WHERE trader_id=?').get(traderId);
    if (!exists) {
      db.prepare(`INSERT OR IGNORE INTO traders (trader_id, cid, ac, country, device_type) VALUES (?,?,?,?,?)`)
        .run(traderId, p.cid||null, p.ac||null, p.country||null, p.device_type||null);
    }
    syncTraderAPI(traderId).catch(() => {});
  }

  console.log(`[WH] ${eventType.toUpperCase()} | trader=${traderId||'-'} | amount=${amount} | cid=${p.cid||'-'} | country=${p.country||'-'}`);
  return eventType;
}

app.post('/webhook', (req, res) => {
  const p = { ...req.query, ...req.body };
  processWebhook(p);
  res.json({ ok: true });
});

app.get('/webhook', (req, res) => {
  processWebhook(req.query);
  res.send('OK');
});

// ─── API: GLOBAL STATS ────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const { from, to, cid, country } = req.query;
  const conds = [], params = [];
  if (from)    { conds.push("date(received_at) >= date(?)"); params.push(from); }
  if (to)      { conds.push("date(received_at) <= date(?)"); params.push(to); }
  if (cid)     { conds.push("cid = ?");     params.push(cid); }
  if (country) { conds.push("country = ?"); params.push(country); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const row = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN event_type='click'        THEN click_id  END) AS clicks,
      COUNT(DISTINCT CASE WHEN event_type='registration' THEN trader_id END) AS regs,
      COUNT(DISTINCT CASE WHEN event_type='ftd'          THEN trader_id END) AS ftd_count,
      ROUND(SUM(CASE WHEN event_type='ftd'               THEN amount ELSE 0 END),2) AS ftd_sum,
      COUNT(CASE        WHEN event_type IN ('deposit','re-deposit') THEN 1 END) AS dep_count,
      ROUND(SUM(CASE WHEN event_type IN ('deposit','re-deposit')    THEN amount ELSE 0 END),2) AS dep_sum,
      ROUND(SUM(CASE WHEN event_type IN ('withdrawal','successful_withdrawal','new_withdrawal') THEN amount ELSE 0 END),2) AS withdrawal_sum,
      ROUND(SUM(CASE WHEN event_type='commission' THEN amount ELSE 0 END),2) AS commission_sum,
      COUNT(DISTINCT trader_id) AS total_traders
    FROM events ${where}
  `).get(...params);

  const clicks = row.clicks || 0;
  const regs   = row.regs   || 0;
  const ctr    = clicks > 0 ? +((regs / clicks) * 100).toFixed(1) : 0;
  const rtd    = regs   > 0 ? +((row.ftd_count / regs) * 100).toFixed(1) : 0;
  const ctd    = regs   > 0 ? +((row.dep_count / regs) * 100).toFixed(1) : 0;

  res.json({ ...row, ctr, rtd, ctd, clicks, regs });
});

// ─── API: DAILY CHART ─────────────────────────────────────────────────────────
app.get('/api/chart/daily', (req, res) => {
  const { from, to, cid, country } = req.query;
  const conds = [], params = [];
  if (from)    { conds.push("date(received_at) >= date(?)"); params.push(from); }
  if (to)      { conds.push("date(received_at) <= date(?)"); params.push(to); }
  if (cid)     { conds.push("cid = ?");     params.push(cid); }
  if (country) { conds.push("country = ?"); params.push(country); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT
      date(received_at) AS day,
      COUNT(DISTINCT CASE WHEN event_type='registration' THEN trader_id END) AS regs,
      COUNT(DISTINCT CASE WHEN event_type='ftd'          THEN trader_id END) AS ftd,
      ROUND(SUM(CASE WHEN event_type IN ('deposit','re-deposit') THEN amount ELSE 0 END),2) AS deposits,
      ROUND(SUM(CASE WHEN event_type='commission' THEN amount ELSE 0 END),2) AS commission
    FROM events ${where}
    GROUP BY day ORDER BY day ASC LIMIT 90
  `).all(...params);
  res.json(rows);
});

// ─── API: BY CAMPAIGN ─────────────────────────────────────────────────────────
app.get('/api/chart/campaigns', (req, res) => {
  const { from, to } = req.query;
  const conds = [], params = [];
  if (from) { conds.push("date(received_at) >= date(?)"); params.push(from); }
  if (to)   { conds.push("date(received_at) <= date(?)"); params.push(to); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT
      COALESCE(cid,'(none)') AS campaign,
      COALESCE(ac,'') AS campaign_name,
      COUNT(DISTINCT CASE WHEN event_type='registration' THEN trader_id END) AS regs,
      COUNT(DISTINCT CASE WHEN event_type='ftd'          THEN trader_id END) AS ftd,
      ROUND(SUM(CASE WHEN event_type IN ('deposit','re-deposit') THEN amount ELSE 0 END),2) AS deposits,
      ROUND(SUM(CASE WHEN event_type='commission' THEN amount ELSE 0 END),2) AS commission
    FROM events ${where}
    GROUP BY cid ORDER BY regs DESC LIMIT 20
  `).all(...params);
  res.json(rows);
});

// ─── API: BY GEO ──────────────────────────────────────────────────────────────
app.get('/api/chart/geo', (req, res) => {
  const { from, to, cid } = req.query;
  const conds = [], params = [];
  if (from) { conds.push("date(received_at) >= date(?)"); params.push(from); }
  if (to)   { conds.push("date(received_at) <= date(?)"); params.push(to); }
  if (cid)  { conds.push("cid = ?"); params.push(cid); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT
      COALESCE(country,'Unknown') AS country,
      COUNT(DISTINCT CASE WHEN event_type='registration' THEN trader_id END) AS regs,
      COUNT(DISTINCT CASE WHEN event_type='ftd'          THEN trader_id END) AS ftd,
      ROUND(SUM(CASE WHEN event_type IN ('deposit','re-deposit') THEN amount ELSE 0 END),2) AS deposits
    FROM events ${where}
    GROUP BY country ORDER BY regs DESC LIMIT 15
  `).all(...params);
  res.json(rows);
});

// ─── API: TRADERS ─────────────────────────────────────────────────────────────
app.get('/api/traders', (req, res) => {
  const { cid, country, search, limit = 50, offset = 0 } = req.query;
  const conds = [], params = [];
  if (cid)     { conds.push('t.cid = ?');         params.push(cid); }
  if (country) { conds.push('t.country = ?');     params.push(country); }
  if (search)  { conds.push('t.trader_id LIKE ?');params.push(`%${search}%`); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const traders = db.prepare(`
    SELECT
      t.trader_id, t.country, t.device_type, t.cid, t.ac,
      t.registered_at, t.api_status, t.api_real_balance, t.api_last_sync,
      COUNT(DISTINCT CASE WHEN e.event_type='ftd' THEN e.id END) AS ftd_count,
      ROUND(SUM(CASE WHEN e.event_type='ftd' THEN e.amount ELSE 0 END),2) AS ftd_sum,
      COUNT(CASE WHEN e.event_type IN ('deposit','re-deposit') THEN 1 END) AS dep_count,
      ROUND(SUM(CASE WHEN e.event_type IN ('deposit','re-deposit') THEN e.amount ELSE 0 END),2) AS dep_sum,
      ROUND(SUM(CASE WHEN e.event_type IN ('withdrawal','successful_withdrawal') THEN e.amount ELSE 0 END),2) AS withdrawal_sum,
      ROUND(SUM(CASE WHEN e.event_type='commission' THEN e.amount ELSE 0 END),2) AS commission_sum
    FROM traders t
    LEFT JOIN events e ON e.trader_id = t.trader_id
    ${where}
    GROUP BY t.trader_id
    ORDER BY t.registered_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), parseInt(offset));

  const total = db.prepare(`SELECT COUNT(*) as n FROM traders t ${where}`).get(...params).n;
  res.json({ traders, total });
});

// ─── API: RECENT EVENTS ───────────────────────────────────────────────────────
app.get('/api/events/recent', (req, res) => {
  const rows = db.prepare(`
    SELECT id, event_type, trader_id, cid, ac, country, device_type, amount, received_at
    FROM events ORDER BY id DESC LIMIT 100
  `).all();
  res.json(rows);
});

// ─── API: FILTER OPTIONS ──────────────────────────────────────────────────────
app.get('/api/filters', (req, res) => {
  const campaigns = db.prepare(`SELECT DISTINCT cid, ac FROM events WHERE cid IS NOT NULL ORDER BY cid`).all();
  const countries = db.prepare(`SELECT DISTINCT country FROM events WHERE country IS NOT NULL ORDER BY country`).all().map(r => r.country);
  res.json({ campaigns, countries });
});

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const ev = db.prepare('SELECT COUNT(*) as n FROM events').get();
  const tr = db.prepare('SELECT COUNT(*) as n FROM traders').get();
  res.json({ ok: true, events: ev.n, traders: tr.n, partner_id: PP_PARTNER_ID });
});

app.listen(PORT, () => {
  console.log(`\n🚀 PP CRM Server → http://localhost:${PORT}`);
  console.log(`   Partner ID : ${PP_PARTNER_ID}`);
  console.log(`\n📋 Postbacks to create in Pocket Partners (Global, all macros on):`);
  ['registration','ftd','deposit','re-deposit','withdrawal','commission','email_confirmation','new_withdrawal','canceled_withdrawal','successful_withdrawal'].forEach(e => {
    console.log(`   https://YOUR_DOMAIN/webhook?event=${e}`);
  });
  console.log('');
});

// ─── AUTO IMPORT CSV AU DÉMARRAGE ────────────────────────────────────────────
function autoImportCSV() {
  const count = db.prepare('SELECT COUNT(*) as n FROM events').get().n;
  if (count > 0) {
    console.log(`[CSV] Base déjà peuplée (${count} events) — import ignoré`);
    return;
  }

  console.log('[CSV] Base vide — import des données historiques...');

  const CSV_DATA = `Day;Clicks;Registrations;CTR;"FTD count";RTD;CTD;"FTD sum";"Count of deposits";Deposits;Withdrawals;NetDep;Commission;"Active Traders";"Trades #";"Avg FTD";"Avg Dep"
10.03.2026;3;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
11.03.2026;4;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
14.03.2026;1;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
17.03.2026;5;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
20.03.2026;1;1;100;0;0;0;0;0;0;0;0;0;0;0;0;0
21.03.2026;1;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
22.03.2026;1;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
23.03.2026;3;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
24.03.2026;2;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
25.03.2026;1;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
26.03.2026;2;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
27.03.2026;2;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
02.04.2026;1;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
04.04.2026;1;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
05.04.2026;4;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
06.04.2026;5;2;40;1;50;20;106.25;1;106.25;0;106.25;74.38;1;46;106.25;106.25
07.04.2026;2;1;50;0;0;0;0;0;0;0;0;0;0;0;0;0
08.04.2026;2;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
09.04.2026;1;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
11.04.2026;2;0;0;0;0;0;0;1;21.58;0;21.58;15.1;1;22;0;21.58
12.04.2026;3;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
13.04.2026;2;1;50;0;0;0;0;1;215.75;0;215.75;1;1;26;0;215.75
14.04.2026;3;0;0;0;0;0;0;0;0;0;0;60.26;1;162;0;0
15.04.2026;2;1;50;0;0;0;0;1;21.72;0;21.72;104.97;1;14;0;21.72
16.04.2026;0;0;0;0;0;0;0;1;47.84;0;47.84;33.49;1;67;0;47.84
17.04.2026;3;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
18.04.2026;2;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
19.04.2026;2;0;0;0;0;0;0;1;54.16;0;54.16;0.19;1;9;0;54.16
20.04.2026;1;1;100;0;0;0;0;0;0;0;0;37.72;1;258;0;0
22.04.2026;2;1;50;1;100;50;54.07;1;54.07;0;54.07;0;0;0;54.07;54.07
23.04.2026;2;0;0;0;0;0;0;0;0;63.21;-63.21;0;0;0;0;0
25.04.2026;1;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
26.04.2026;2;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
27.04.2026;3;1;33.33;0;0;0;0;0;0;0;0;0;0;0;0;0
28.04.2026;1;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0`;

  const parseNum = v => { const n = parseFloat((v||'0').replace(',','.')); return isNaN(n)?0:n; };
  const parseDate = v => { if(!v) return null; const p=v.trim().split('.'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:v.trim(); };

  const lines = CSV_DATA.split('\n').map(l=>l.trim()).filter(Boolean);
  const headers = lines[0].split(';').map(h=>h.replace(/"/g,'').trim());

  const insertEvent = db.prepare(`INSERT INTO events (event_type, amount, received_at, raw_payload) VALUES (?,?,?,?)`);

  const importAll = db.transaction(() => {
    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(';');
      const get  = key => { const idx=headers.indexOf(key); return idx>=0?(cols[idx]||'').replace(/"/g,'').trim():'0'; };
      const day  = parseDate(get('Day'));
      if (!day) continue;
      const src  = JSON.stringify({ source: 'csv', day });
      const clicks        = parseNum(get('Clicks'));
      const registrations = parseNum(get('Registrations'));
      const ftd_count     = parseNum(get('FTD count'));
      const ftd_sum       = parseNum(get('FTD sum'));
      const dep_count     = parseNum(get('Count of deposits'));
      const deposits      = parseNum(get('Deposits'));
      const withdrawals   = parseNum(get('Withdrawals'));
      const commission    = parseNum(get('Commission'));

      for (let c=0; c<clicks; c++)        insertEvent.run('click', 0, `${day}T12:00:00`, src);
      for (let r=0; r<registrations; r++) insertEvent.run('registration', 0, `${day}T12:01:00`, src);
      const ftdEach = ftd_count>0 ? ftd_sum/ftd_count : 0;
      for (let f=0; f<ftd_count; f++)     insertEvent.run('ftd', ftdEach, `${day}T12:02:00`, src);
      const depEach = dep_count>0 ? deposits/dep_count : 0;
      for (let d=0; d<dep_count; d++)     insertEvent.run('deposit', depEach, `${day}T12:03:00`, src);
      if (withdrawals>0) insertEvent.run('withdrawal', withdrawals, `${day}T12:04:00`, src);
      if (commission>0)  insertEvent.run('commission', commission,  `${day}T12:05:00`, src);
      console.log(`  [CSV] ✓ ${day} | clicks=${clicks} regs=${registrations} ftd=${ftd_count} dep=${dep_count}`);
      imported++;
    }
    return imported;
  });

  const n = importAll();
  console.log(`[CSV] ✅ ${n} jours importés`);
}

autoImportCSV();
