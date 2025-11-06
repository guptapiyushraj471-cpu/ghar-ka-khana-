import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    const time = await sql`SELECT now() as now`;
    const hasOrders = await sql`SELECT to_regclass('public.orders') as exists`;
    return res.status(200).json({
      ok: true,
      now: time.rows[0].now,
      orders_table: hasOrders.rows[0].exists !== null
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'db error' });
  }
}
