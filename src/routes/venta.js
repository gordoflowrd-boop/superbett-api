const express = require('express');
const { query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(requireRol('admin', 'central'));

// ======================================================
// GET /api/venta/dia?fecha=YYYY-MM-DD&loteria_id=UUID
// Venta del día agrupada por modalidad + jugada (todas las bancas)
// ======================================================
router.get('/dia', async (req, res) => {
  const { fecha, loteria_id } = req.query;
  const fechaFiltro = fecha || new Date().toISOString().slice(0, 10);

  try {
    // ── Jugadas normales (Q, P, T) ────────────────────
    const normales = await query(
      `SELECT
         td.modalidad,
         td.numeros                              AS jugada,
         l.nombre                                AS loteria,
         l.id                                    AS loteria_id,
         SUM(td.cantidad)::int                   AS cantidad_total,
         COUNT(DISTINCT t.id)::int               AS tickets,
         COUNT(DISTINCT t.banca_id)::int         AS bancas,
         COALESCE(SUM(td.monto), 0)              AS monto_total
       FROM ticket_detalles td
       JOIN tickets  t ON t.id  = td.ticket_id
       JOIN jornadas j ON j.id  = t.jornada_id
       JOIN loterias l ON l.id  = j.loteria_id
       WHERE t.anulado      = false
         AND t.fecha        = $1
         AND td.modalidad  != 'SP'
         AND ($2::uuid IS NULL OR j.loteria_id = $2)
       GROUP BY td.modalidad, td.numeros, l.nombre, l.id
       ORDER BY td.modalidad,
                CASE td.modalidad WHEN 'Q' THEN 1 WHEN 'P' THEN 2 WHEN 'T' THEN 3 ELSE 4 END,
                SUM(td.cantidad) DESC`,
      [fechaFiltro, loteria_id || null]
    );

    // ── Super Palé ────────────────────────────────────
    const superPale = await query(
      `SELECT
         'SP'                                               AS modalidad,
         sp.jugada,
         sp.loteria,
         SUM(sp.cantidad)::int                             AS cantidad_total,
         COUNT(DISTINCT sp.ticket_id)::int                 AS tickets,
         COUNT(DISTINCT sp.banca_id)::int                  AS bancas,
         COALESCE(SUM(sp.monto), 0)                        AS monto_total
       FROM (
         SELECT
           t.id        AS ticket_id,
           t.banca_id,
           td.numeros  AS jugada,
           td.cantidad,
           td.monto,
           string_agg(DISTINCT l.nombre, ' + ' ORDER BY l.nombre) AS loteria
         FROM tickets t
         JOIN ticket_detalles td ON td.ticket_id = t.id
         JOIN ticket_loterias tl ON tl.ticket_id = t.id
         JOIN loterias l         ON l.id         = tl.loteria_id
         WHERE t.anulado     = false
           AND t.fecha       = $1::date
           AND td.modalidad  = 'SP'
           AND ($2::uuid IS NULL OR tl.loteria_id = $2)
         GROUP BY t.id, t.banca_id, td.numeros, td.cantidad, td.monto
       ) sp
       GROUP BY sp.jugada, sp.loteria
       ORDER BY SUM(sp.cantidad) DESC`,
      [fechaFiltro, loteria_id || null]
    );

    // ── Resumen por modalidad ─────────────────────────
    const totales = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN td.modalidad = 'Q'  THEN td.monto ELSE 0 END), 0) AS total_q,
         COALESCE(SUM(CASE WHEN td.modalidad = 'P'  THEN td.monto ELSE 0 END), 0) AS total_p,
         COALESCE(SUM(CASE WHEN td.modalidad = 'T'  THEN td.monto ELSE 0 END), 0) AS total_t,
         COALESCE(SUM(CASE WHEN td.modalidad = 'SP' THEN td.monto ELSE 0 END), 0) AS total_sp,
         COALESCE(SUM(td.monto), 0)                                                AS total_general
       FROM ticket_detalles td
       JOIN tickets  t ON t.id = td.ticket_id
       WHERE t.anulado = false AND t.fecha = $1`,
      [fechaFiltro]
    );

    res.json({
      fecha:         fechaFiltro,
      normales:      normales.rows,
      super_pale:    superPale.rows,
      totales:       totales.rows[0],
    });

  } catch (err) {
    console.error('Error venta/dia:', err);
    res.status(500).json({ error: 'Error al obtener venta del día' });
  }
});

module.exports = router;
