import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { status } = req.body || {};
    const allowed = ['PLACED','CONFIRMED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    }

    const { rows } = await sql`
      UPDATE orders SET status = ${status} WHERE id = ${id} RETURNING *;
    `;
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.status(200).json({ ok: true, data: rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}
