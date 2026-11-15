// 여행 플래너 데이터 API — Upstash Redis(REST) 사용
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
let seed = {};
try { seed = JSON.parse(process.env.SEED_JSON || '{}'); } catch (e) {}

async function redis(cmds) {
  const r = await fetch(RURL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(j.error || 'redis error');
  return j.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}
let seeded = false;
async function ensureSeed() {
  if (seeded) return;
  const [s] = await redis([['GET', 'seeded']]);
  if (!s) {
    const cmds = [];
    for (const [col, docs] of Object.entries(seed)) {
      for (const [id, d] of Object.entries(docs)) cmds.push(['HSET', 'c:' + col, id, JSON.stringify(d)]);
      cmds.push(['HINCRBY', 'vers', col, 1]);
    }
    cmds.push(['SET', 'seeded', '1']);
    await redis(cmds);
  }
  seeded = true;
}
const split = (p) => { const i = p.lastIndexOf('/'); return [p.slice(0, i), p.slice(i + 1)]; };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) { for (const k in b) a[k] = isObj(b[k]) && isObj(a[k]) ? merge({ ...a[k] }, b[k]) : b[k]; return a; }
const okPath = (p) => typeof p === 'string' && p.length < 600 && /^[\w.~:@+\-]+(\/[\w.~:@+\-]+)+$/.test(p) && p.split('/').length % 2 === 0;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!RURL || !RTOK) { res.status(503).json({ error: 'db_not_connected' }); return; }
  try {
    await ensureSeed();
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { op, path, data } = body;
      if (!okPath(path)) { res.status(400).json({ error: 'bad_path' }); return; }
      const [col, id] = split(path);
      if (op === 'set') {
        if (!isObj(data)) { res.status(400).json({ error: 'bad_data' }); return; }
        await redis([['HSET', 'c:' + col, id, JSON.stringify(data)], ['HINCRBY', 'vers', col, 1]]);
      } else if (op === 'update') {
        const [cur] = await redis([['HGET', 'c:' + col, id]]);
        if (!cur) { res.status(404).json({ error: 'not_found' }); return; }
        await redis([['HSET', 'c:' + col, id, JSON.stringify(merge(JSON.parse(cur), data || {}))], ['HINCRBY', 'vers', col, 1]]);
      } else if (op === 'delete') {
        await redis([['HDEL', 'c:' + col, id], ['HINCRBY', 'vers', col, 1]]);
      } else { res.status(400).json({ error: 'bad_op' }); return; }
      res.json({ ok: true }); return;
    }
    // 동기화: ?s={"컬렉션":알고있는버전}
    let want = {};
    try { want = JSON.parse(req.query.s || '{}'); } catch (e) {}
    const [vers] = await redis([['HGETALL', 'vers']]);
    const V = {};
    if (Array.isArray(vers)) for (let i = 0; i < vers.length; i += 2) V[vers[i]] = +vers[i + 1];
    else if (vers && typeof vers === 'object') for (const k in vers) V[k] = +vers[k];
    const changed = Object.keys(want).filter((c) => (V[c] || 0) !== want[c]).slice(0, 40);
    const cols = {};
    if (changed.length) {
      const rs = await redis(changed.map((c) => ['HGETALL', 'c:' + c]));
      changed.forEach((c, i) => {
        const a = rs[i] || []; const docs = {};
        if (Array.isArray(a)) for (let k = 0; k < a.length; k += 2) docs[a[k]] = JSON.parse(a[k + 1]);
        else for (const k in a) docs[k] = JSON.parse(a[k]);
        cols[c] = { v: V[c] || 0, docs };
      });
    }
    res.json({ cols });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
