const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const md5 = require('md5');

const app  = express();
const PORT = process.env.PORT || 3001;
const PP_PARTNER_ID = process.env.PP_PARTNER_ID || '44765';
const PP_API_TOKEN  = process.env.PP_API_TOKEN  || 'bYwJH19FHjdmEqaPUbnP';
const PP_API_BASE   = 'https://affiliate.pocketoption.com/api/user-info';

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function query(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); } finally { client.release(); }
}

async function initDB() {
  await query(`CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, event_type TEXT NOT NULL, trader_id TEXT, click_id TEXT, site_id TEXT, cid TEXT, ac TEXT, sub_id1 TEXT, sub_id2 TEXT, sub_id3 TEXT, sub_id4 TEXT, sub_id5 TEXT, country TEXT, promo TEXT, device_type TEXT, os_version TEXT, browser TEXT, link_type TEXT, visitor_id TEXT, amount NUMERIC DEFAULT 0, date_time TEXT, raw_payload TEXT, received_at TIMESTAMP DEFAULT NOW())`);
  await query(`CREATE TABLE IF NOT EXISTS traders (trader_id TEXT PRIMARY KEY, country TEXT, device_type TEXT, browser TEXT, os_version TEXT, cid TEXT, ac TEXT, sub_id1 TEXT, promo TEXT, site_id TEXT, link_type TEXT, registered_at TEXT, api_ftd_amount NUMERIC, api_total_deposits NUMERIC, api_real_balance NUMERIC, api_status TEXT, api_last_sync TIMESTAMP)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ev_type ON events(event_type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ev_date ON events(received_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ev_cid  ON events(cid)`);
  console.log('[DB] Tables ready');
  await autoImportCSV();
}

async function autoImportCSV() {
  const res = await query('SELECT COUNT(*) as n FROM events');
  if (parseInt(res.rows[0].n) > 0) { console.log(`[CSV] ${res.rows[0].n} events already — skip`); return; }
  console.log('[CSV] Importing historical data...');
  const rows = [
    ['10.03.2026',3,0,0,0,0,0,0],['11.03.2026',4,0,0,0,0,0,0],['14.03.2026',1,0,0,0,0,0,0],
    ['17.03.2026',5,0,0,0,0,0,0],['20.03.2026',1,1,0,0,0,0,0],['21.03.2026',1,0,0,0,0,0,0],
    ['22.03.2026',1,0,0,0,0,0,0],['23.03.2026',3,0,0,0,0,0,0],['24.03.2026',2,0,0,0,0,0,0],
    ['25.03.2026',1,0,0,0,0,0,0],['26.03.2026',2,0,0,0,0,0,0],['27.03.2026',2,0,0,0,0,0,0],
    ['02.04.2026',1,0,0,0,0,0,0],['04.04.2026',1,0,0,0,0,0,0],['05.04.2026',4,0,0,0,0,0,0],
    ['06.04.2026',5,2,1,106.25,1,106.25,74.38],['07.04.2026',2,1,0,0,0,0,0],
    ['08.04.2026',2,0,0,0,0,0,0],['09.04.2026',1,0,0,0,0,0,0],
    ['11.04.2026',2,0,0,0,1,21.58,15.1],['12.04.2026',3,0,0,0,0,0,0],
    ['13.04.2026',2,1,0,0,1,215.75,1],['14.04.2026',3,0,0,0,0,0,60.26],
    ['15.04.2026',2,1,0,0,1,21.72,104.97],['16.04.2026',0,0,0,0,1,47.84,33.49],
    ['17.04.2026',3,0,0,0,0,0,0],['18.04.2026',2,0,0,0,0,0,0],
    ['19.04.2026',2,0,0,0,1,54.16,0.19],['20.04.2026',1,1,0,0,0,0,37.72],
    ['22.04.2026',2,1,1,54.07,1,54.07,0],['23.04.2026',2,0,0,0,0,0,0],
    ['25.04.2026',1,0,0,0,0,0,0],['26.04.2026',2,0,0,0,0,0,0],
    ['27.04.2026',3,1,0,0,0,0,0],['28.04.2026',1,0,0,0,0,0,0]
  ];
  const pD = v => { const p=v.split('.'); return `${p[2]}-${p[1]}-${p[0]}`; };
  const ins = (t,a,d) => query('INSERT INTO events (event_type,amount,received_at,raw_payload) VALUES ($1,$2,$3,$4)',[t,a,d,JSON.stringify({source:'csv'})]);
  for (const [date,clicks,regs,ftdN,ftdS,depN,depS,comm] of rows) {
    const day = pD(date);
    for(let c=0;c<clicks;c++) await ins('click',0,`${day}T12:00:00`);
    for(let r=0;r<regs;r++)   await ins('registration',0,`${day}T12:01:00`);
    if(ftdN>0) await ins('ftd',ftdS/ftdN,`${day}T12:02:00`);
    if(depN>0) await ins('deposit',depS/depN,`${day}T12:03:00`);
    if(comm>0) await ins('commission',comm,`${day}T12:05:00`);
    console.log(`  [CSV] ✓ ${day}`);
  }
  console.log('[CSV] ✅ Done');
}

async function syncTraderAPI(traderId) {
  try {
    const hash = md5(`${traderId}:${PP_PARTNER_ID}:${PP_API_TOKEN}`);
    const res  = await fetch(`${PP_API_BASE}/${traderId}/${PP_PARTNER_ID}/${hash}`,{signal:AbortSignal.timeout(5000)});
    if(!res.ok) return;
    const data = await res.json();
    await query('UPDATE traders SET api_ftd_amount=$1,api_total_deposits=$2,api_real_balance=$3,api_status=$4,api_last_sync=NOW() WHERE trader_id=$5',
      [data.ftd_amount||null,data.total_deposits||null,data.real_balance||null,data.status||null,traderId]);
  } catch(e){}
}

async function processWebhook(p) {
  const ev=p.event||'unknown', tid=p.trader_id||null, amt=parseFloat(p.sumdep||p.wdr_sum||p.commission||p.amount||0)||0;
  await query('INSERT INTO events (event_type,trader_id,click_id,site_id,cid,ac,sub_id1,sub_id2,sub_id3,sub_id4,sub_id5,country,promo,device_type,os_version,browser,link_type,visitor_id,amount,date_time,raw_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)',
    [ev,tid,p.click_id||null,p.site_id||null,p.cid||null,p.ac||null,p.sub_id1||null,p.sub_id2||null,p.sub_id3||null,p.sub_id4||null,p.sub_id5||null,p.country||null,p.promo||null,p.device_type||null,p.os_version||null,p.browser||null,p.link_type||null,p.visitor_id||null,amt,p.date_time||null,JSON.stringify(p)]);
  if(tid&&ev==='registration'){
    await query('INSERT INTO traders (trader_id,country,device_type,browser,os_version,cid,ac,sub_id1,promo,site_id,link_type,registered_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING',
      [tid,p.country||null,p.device_type||null,p.browser||null,p.os_version||null,p.cid||null,p.ac||null,p.sub_id1||null,p.promo||null,p.site_id||null,p.link_type||null,p.date_time||new Date().toISOString()]);
    syncTraderAPI(tid).catch(()=>{});
  }
  if(tid&&['ftd','deposit','re-deposit'].includes(ev)){
    await query('INSERT INTO traders (trader_id,cid,ac,country,device_type) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[tid,p.cid||null,p.ac||null,p.country||null,p.device_type||null]);
    syncTraderAPI(tid).catch(()=>{});
  }
  console.log(`[WH] ${ev.toUpperCase()} | trader=${tid||'-'} | amount=${amt}`);
}

app.post('/webhook', async(req,res)=>{ await processWebhook({...req.query,...req.body}); res.json({ok:true}); });
app.get('/webhook',  async(req,res)=>{ await processWebhook(req.query); res.send('OK'); });

app.get('/api/stats', async(req,res)=>{
  const {from,to,cid,country}=req.query, conds=[],params=[];let i=1;
  if(from){conds.push(`DATE(received_at)>=DATE($${i++})`);params.push(from);}
  if(to)  {conds.push(`DATE(received_at)<=DATE($${i++})`);params.push(to);}
  if(cid) {conds.push(`cid=$${i++}`);params.push(cid);}
  if(country){conds.push(`country=$${i++}`);params.push(country);}
  const w=conds.length?'WHERE '+conds.join(' AND '):'';
  const r=await query(`SELECT COUNT(DISTINCT CASE WHEN event_type='click' THEN click_id END)::int AS clicks, COUNT(DISTINCT CASE WHEN event_type='registration' THEN trader_id END)::int AS regs, COUNT(DISTINCT CASE WHEN event_type='ftd' THEN trader_id END)::int AS ftd_count, ROUND(SUM(CASE WHEN event_type='ftd' THEN amount ELSE 0 END),2) AS ftd_sum, COUNT(CASE WHEN event_type IN ('deposit','re-deposit') THEN 1 END)::int AS dep_count, ROUND(SUM(CASE WHEN event_type IN ('deposit','re-deposit') THEN amount ELSE 0 END),2) AS dep_sum, ROUND(SUM(CASE WHEN event_type IN ('withdrawal','successful_withdrawal','new_withdrawal') THEN amount ELSE 0 END),2) AS withdrawal_sum, ROUND(SUM(CASE WHEN event_type='commission' THEN amount ELSE 0 END),2) AS commission_sum, COUNT(DISTINCT trader_id)::int AS total_traders FROM events ${w}`,params);
  const row=r.rows[0],clicks=row.clicks||0,regs=row.regs||0;
  res.json({...row,ctr:clicks>0?+((regs/clicks)*100).toFixed(1):0,rtd:regs>0?+((row.ftd_count/regs)*100).toFixed(1):0,ctd:regs>0?+((row.dep_count/regs)*100).toFixed(1):0,clicks,regs});
});

app.get('/api/chart/daily', async(req,res)=>{
  const {from,to,cid,country}=req.query,conds=[],params=[];let i=1;
  if(from){conds.push(`DATE(received_at)>=DATE($${i++})`);params.push(from);}
  if(to)  {conds.push(`DATE(received_at)<=DATE($${i++})`);params.push(to);}
  if(cid) {conds.push(`cid=$${i++}`);params.push(cid);}
  if(country){conds.push(`country=$${i++}`);params.push(country);}
  const w=conds.length?'WHERE '+conds.join(' AND '):'';
  const r=await query(`SELECT DATE(received_at) AS day, COUNT(DISTINCT CASE WHEN event_type='registration' THEN trader_id END)::int AS regs, COUNT(DISTINCT CASE WHEN event_type='ftd' THEN trader_id END)::int AS ftd, ROUND(SUM(CASE WHEN event_type IN ('deposit','re-deposit') THEN amount ELSE 0 END),2) AS deposits, ROUND(SUM(CASE WHEN event_type='commission' THEN amount ELSE 0 END),2) AS commission FROM events ${w} GROUP BY day ORDER BY day ASC LIMIT 90`,params);
  res.json(r.rows);
});

app.get('/api/chart/campaigns', async(req,res)=>{
  const {from,to}=req.query,conds=[],params=[];let i=1;
  if(from){conds.push(`DATE(received_at)>=DATE($${i++})`);params.push(from);}
  if(to)  {conds.push(`DATE(received_at)<=DATE($${i++})`);params.push(to);}
  const w=conds.length?'WHERE '+conds.join(' AND '):'';
  const r=await query(`SELECT COALESCE(cid,'(none)') AS campaign, COALESCE(ac,'') AS campaign_name, COUNT(DISTINCT CASE WHEN event_type='registration' THEN trader_id END)::int AS regs, COUNT(DISTINCT CASE WHEN event_type='ftd' THEN trader_id END)::int AS ftd, ROUND(SUM(CASE WHEN event_type IN ('deposit','re-deposit') THEN amount ELSE 0 END),2) AS deposits, ROUND(SUM(CASE WHEN event_type='commission' THEN amount ELSE 0 END),2) AS commission FROM events ${w} GROUP BY cid,ac ORDER BY regs DESC LIMIT 20`,params);
  res.json(r.rows);
});

app.get('/api/chart/geo', async(req,res)=>{
  const {from,to,cid}=req.query,conds=[],params=[];let i=1;
  if(from){conds.push(`DATE(received_at)>=DATE($${i++})`);params.push(from);}
  if(to)  {conds.push(`DATE(received_at)<=DATE($${i++})`);params.push(to);}
  if(cid) {conds.push(`cid=$${i++}`);params.push(cid);}
  const w=conds.length?'WHERE '+conds.join(' AND '):'';
  const r=await query(`SELECT COALESCE(country,'Unknown') AS country, COUNT(DISTINCT CASE WHEN event_type='registration' THEN trader_id END)::int AS regs, COUNT(DISTINCT CASE WHEN event_type='ftd' THEN trader_id END)::int AS ftd, ROUND(SUM(CASE WHEN event_type IN ('deposit','re-deposit') THEN amount ELSE 0 END),2) AS deposits FROM events ${w} GROUP BY country ORDER BY regs DESC LIMIT 15`,params);
  res.json(r.rows);
});

app.get('/api/traders', async(req,res)=>{
  const {cid,country,search,limit=50,offset=0}=req.query,conds=[],params=[];let i=1;
  if(cid)    {conds.push(`t.cid=$${i++}`);params.push(cid);}
  if(country){conds.push(`t.country=$${i++}`);params.push(country);}
  if(search) {conds.push(`t.trader_id ILIKE $${i++}`);params.push(`%${search}%`);}
  const w=conds.length?'WHERE '+conds.join(' AND '):'';
  const traders=await query(`SELECT t.trader_id,t.country,t.device_type,t.cid,t.ac,t.registered_at,t.api_status,t.api_real_balance,t.api_last_sync, COUNT(DISTINCT CASE WHEN e.event_type='ftd' THEN e.id END)::int AS ftd_count, ROUND(SUM(CASE WHEN e.event_type='ftd' THEN e.amount ELSE 0 END),2) AS ftd_sum, COUNT(CASE WHEN e.event_type IN ('deposit','re-deposit') THEN 1 END)::int AS dep_count, ROUND(SUM(CASE WHEN e.event_type IN ('deposit','re-deposit') THEN e.amount ELSE 0 END),2) AS dep_sum, ROUND(SUM(CASE WHEN e.event_type IN ('withdrawal','successful_withdrawal') THEN e.amount ELSE 0 END),2) AS withdrawal_sum, ROUND(SUM(CASE WHEN e.event_type='commission' THEN e.amount ELSE 0 END),2) AS commission_sum FROM traders t LEFT JOIN events e ON e.trader_id=t.trader_id ${w} GROUP BY t.trader_id ORDER BY t.registered_at DESC NULLS LAST LIMIT $${i++} OFFSET $${i++}`, [...params,parseInt(limit),parseInt(offset)]);
  const total=await query(`SELECT COUNT(*) as n FROM traders t ${w}`,params);
  res.json({traders:traders.rows,total:parseInt(total.rows[0].n)});
});

app.get('/api/events/recent', async(req,res)=>{
  const r=await query('SELECT id,event_type,trader_id,cid,ac,country,device_type,amount,received_at FROM events ORDER BY id DESC LIMIT 100');
  res.json(r.rows);
});

app.get('/api/filters', async(req,res)=>{
  const c=await query('SELECT DISTINCT cid,ac FROM events WHERE cid IS NOT NULL ORDER BY cid');
  const g=await query('SELECT DISTINCT country FROM events WHERE country IS NOT NULL ORDER BY country');
  res.json({campaigns:c.rows,countries:g.rows.map(r=>r.country)});
});

app.get('/health', async(req,res)=>{
  const ev=await query('SELECT COUNT(*) as n FROM events');
  const tr=await query('SELECT COUNT(*) as n FROM traders');
  res.json({ok:true,events:parseInt(ev.rows[0].n),traders:parseInt(tr.rows[0].n),partner_id:PP_PARTNER_ID});
});

// ─── CLEANUP TEST DATA
app.get('/api/cleanup-test', async(req,res)=>{
  const secret = req.query.secret;
  if(secret !== 'cleanup44765') return res.status(403).json({error:'forbidden'});
  const r = await query(`DELETE FROM events WHERE trader_id LIKE 'TEST%' OR raw_payload LIKE '%"source":"csv"%'`);
  const t = await query(`DELETE FROM traders WHERE trader_id LIKE 'TEST%'`);
  res.json({ok:true, deleted_events: r.rowCount, deleted_traders: t.rowCount});
});

app.listen(PORT, async()=>{
  console.log(`\n🚀 PP CRM → http://localhost:${PORT} | Partner: ${PP_PARTNER_ID}`);
  await initDB();
});
