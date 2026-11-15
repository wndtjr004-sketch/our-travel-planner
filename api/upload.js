// 예약 캡처·대표 이미지 업로드 — Vercel Blob
const { put } = require('@vercel/blob');
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 4.3e6) { res.status(413).json({ error: '파일이 너무 커요 (4MB 이하)' }); return; } chunks.push(c); }
    const name = String(req.query.name || 'file').replace(/[^\w.\-]/g, '_').slice(-60) || 'file';
    const r = await put(`uploads/${Date.now()}-${name}`, Buffer.concat(chunks), {
      access: 'public', addRandomSuffix: true, contentType: req.headers['content-type'] || 'application/octet-stream',
    });
    res.json({ id: r.url, url: r.url, contentType: r.contentType, sizeBytes: size });
  } catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
};
