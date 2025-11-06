import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { rows } = await sql`SELECT * FROM orders ORDER BY created_at DESC LIMIT 200`;
      return res.status(200).json({ ok: true, data: rows });
    }

    if (req.method === 'POST') {
      const { name, phone, address, items, amount, note } = req.body || {};
      if (!name || !phone || !address || !Array.isArray(items)) {
        return res.status(400).json({ ok: false, error: 'Missing required fields' });
      }
      const amt = Number(amount || 0);
      const { rows } = await sql`
        INSERT INTO orders (name, phone, address, items, amount, note, status)
        VALUES (${name}, ${phone}, ${address}, ${JSON.stringify(items)}, ${amt}, ${note || null}, 'PLACED')
        RETURNING *;
      `;
      return res.status(201).json({ ok: true, data: rows[0] });
    }

    res.setHeader('Allow', 'GET,POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}
