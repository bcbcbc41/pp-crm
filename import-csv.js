/**
 * import-csv.js
 * 
 * Importe les statistiques historiques du CSV Pocket Partners dans la base SQLite.
 * 
 * Usage:
 *   node import-csv.js statistics_2026-04-28_142050.csv
 */

const Database = require('better-sqlite3');
const path = require('path');

// Données CSV intégrées directement (plus besoin de fichier externe)
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

const db = new Database(path.join(__dirname, 'crm.db'));
db.pragma('journal_mode = WAL');

// S'assure que les tables existent (au cas où on lance avant server.js)
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

  CREATE TABLE IF NOT EXISTS csv_stats (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    day          TEXT UNIQUE,
    clicks       INTEGER DEFAULT 0,
    registrations INTEGER DEFAULT 0,
    ctr          REAL DEFAULT 0,
    ftd_count    INTEGER DEFAULT 0,
    rtd          REAL DEFAULT 0,
    ctd          REAL DEFAULT 0,
    ftd_sum      REAL DEFAULT 0,
    dep_count    INTEGER DEFAULT 0,
    deposits     REAL DEFAULT 0,
    withdrawals  REAL DEFAULT 0,
    net_dep      REAL DEFAULT 0,
    commission   REAL DEFAULT 0,
    active_traders INTEGER DEFAULT 0,
    trades_count INTEGER DEFAULT 0,
    avg_ftd      REAL DEFAULT 0,
    avg_dep      REAL DEFAULT 0,
    imported_at  TEXT DEFAULT (datetime('now'))
  );
`);

// Parse le CSV (données intégrées directement, pas besoin de fichier)
const content = CSV_DATA;
const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

// Cherche la ligne d'en-tête
const headerIdx = lines.findIndex(l => l.startsWith('Day'));
if (headerIdx === -1) {
  console.error('En-tête "Day" introuvable dans le CSV');
  process.exit(1);
}

const headers = lines[headerIdx].split(';').map(h => h.replace(/"/g, '').trim());
console.log('Colonnes détectées:', headers);

const parseNum = v => {
  const n = parseFloat((v || '0').replace(',', '.'));
  return isNaN(n) ? 0 : n;
};

// Convertit DD.MM.YYYY → YYYY-MM-DD
const parseDate = v => {
  if (!v) return null;
  const parts = v.trim().split('.');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return v.trim();
};

const insertStat = db.prepare(`
  INSERT OR REPLACE INTO csv_stats
    (day, clicks, registrations, ctr, ftd_count, rtd, ctd,
     ftd_sum, dep_count, deposits, withdrawals, net_dep,
     commission, active_traders, trades_count, avg_ftd, avg_dep)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

const insertEvent = db.prepare(`
  INSERT INTO events
    (event_type, amount, received_at, raw_payload)
  VALUES (?,?,?,?)
`);

// Vérifie si des events CSV existent déjà
const existingCsvEvents = db.prepare(`SELECT COUNT(*) as n FROM events WHERE raw_payload LIKE '%"source":"csv"%'`).get().n;

let imported = 0;
let skipped  = 0;

const importAll = db.transaction(() => {
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith(';')) continue;

    const cols = line.split(';');
    const get  = key => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? (cols[idx] || '').replace(/"/g, '').trim() : '0';
    };

    const day          = parseDate(get('Day'));
    if (!day) continue;

    const clicks       = parseNum(get('Clicks'));
    const registrations= parseNum(get('Registrations'));
    const ctr          = parseNum(get('CTR'));
    const ftd_count    = parseNum(get('FTD count'));
    const rtd          = parseNum(get('RTD'));
    const ctd          = parseNum(get('CTD'));
    const ftd_sum      = parseNum(get('FTD sum'));
    const dep_count    = parseNum(get('Count of deposits'));
    const deposits     = parseNum(get('Deposits'));
    const withdrawals  = parseNum(get('Withdrawals'));
    const net_dep      = parseNum(get('NetDep'));
    const commission   = parseNum(get('Commission'));
    const active_traders = parseNum(get('Active Traders'));
    const trades_count = parseNum(get('Trades #'));
    const avg_ftd      = parseNum(get('Avg FTD'));
    const avg_dep      = parseNum(get('Avg Dep'));

    // Stocke dans csv_stats (table dédiée à l'historique)
    insertStat.run(
      day, clicks, registrations, ctr, ftd_count, rtd, ctd,
      ftd_sum, dep_count, deposits, withdrawals, net_dep,
      commission, active_traders, trades_count, avg_ftd, avg_dep
    );

    // Injecte aussi dans events pour que les graphiques fonctionnent
    if (existingCsvEvents === 0) {
      const src = JSON.stringify({ source: 'csv', day });

      // Clicks synthétiques
      for (let c = 0; c < clicks; c++) {
        insertEvent.run('click', 0, `${day}T12:00:00`, src);
      }
      // Registrations
      for (let r = 0; r < registrations; r++) {
        insertEvent.run('registration', 0, `${day}T12:01:00`, src);
      }
      // FTD
      const ftdAmountEach = ftd_count > 0 ? ftd_sum / ftd_count : 0;
      for (let f = 0; f < ftd_count; f++) {
        insertEvent.run('ftd', ftdAmountEach, `${day}T12:02:00`, src);
      }
      // Dépôts
      const depAmountEach = dep_count > 0 ? deposits / dep_count : 0;
      for (let d = 0; d < dep_count; d++) {
        insertEvent.run('deposit', depAmountEach, `${day}T12:03:00`, src);
      }
      // Withdrawals (montant global en 1 event si > 0)
      if (withdrawals > 0) {
        insertEvent.run('withdrawal', withdrawals, `${day}T12:04:00`, src);
      }
      // Commission
      if (commission > 0) {
        insertEvent.run('commission', commission, `${day}T12:05:00`, src);
      }
    }

    imported++;
    console.log(`  ✓ ${day} | clicks=${clicks} regs=${registrations} ftd=${ftd_count}($${ftd_sum}) dep=${dep_count}($${deposits}) comm=$${commission}`);
  }
});

importAll();

const total = db.prepare('SELECT COUNT(*) as n FROM events').get().n;
console.log(`\n✅ Import terminé : ${imported} jours importés`);
console.log(`   Total events en base : ${total}`);
console.log(`   Lance maintenant : node server.js`);
