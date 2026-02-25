const express = require('express');
const { query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ======================================================
// GET /api/reportes/ganadores
// ======================================================
router.get('/ganadores', requireRol('admin', 'central', 'rifero'), async (req, res) => {
  const { fecha, loteria_id } = req.query;
  try {
    const result = await query(
      'SELECT ganadores_del_dia($1::date, $2::uuid)',
      [fecha || null, loteria_id || null]
    );
    res.json(result.rows[0]?.ganadores_del_dia || []);
  } catch (err) {
    console.error('Error ganadores_del_dia:', err);
    res.status(500).json({ error: 'Error al obtener ganadores' });
  }
});

// ======================================================
// GET /api/reportes/resumen
// ======================================================
router.get('/resumen', requireRol('admin', 'central'), async (req, res) => {
  const { fecha } = req.query;
  try {
    const result = await query(
      'SELECT resumen_admin_dia($1::date)',
      [fecha || null]
    );
    res.json(result.rows[0]?.resumen_admin_dia || {});
  } catch (err) {
    console.error('Error resumen_admin_dia:', err);
    res.status(500).json({ error: 'Error al obtener resumen' });
  }
});

// ======================================================
// GET /api/reportes/banca?fecha=&banca_id=
// ======================================================
router.get('/banca', requireRol('admin', 'central', 'rifero', 'vendedor'), async (req, res) => {
  const { banca_id, fecha } = req.query;
  const bancaFiltro = req.usuario.rol === 'vendedor' ? req.usuario.banca_id : banca_id;
  const f = fecha || null;

  if (!bancaFiltro) {
    return res.status(400).json({ error: 'banca_id es requerido' });
  }

  try {

    // ── RESUMEN GENERAL ──────────────────────────────
    const resResumen = await query(
      `SELECT
         (SELECT COUNT(id)            FROM tickets WHERE banca_id = $1 AND anulado = false AND ($2::date IS NULL OR fecha = $2)) AS total_tickets,
         (SELECT COUNT(id)            FROM tickets WHERE banca_id = $1 AND anulado = true  AND ($2::date IS NULL OR fecha = $2)) AS tickets_anulados,
         (SELECT COALESCE(SUM(total_monto), 0)
                                      FROM tickets WHERE banca_id = $1 AND anulado = false AND ($2::date IS NULL OR fecha = $2)) AS total_venta,
         (SELECT COALESCE(SUM(gl.monto), 0)
          FROM ganadores_loteria gl
          JOIN tickets t ON t.id = gl.ticket_id
          WHERE t.banca_id = $1 AND t.anulado = false AND ($2::date IS NULL OR t.fecha = $2))  AS total_premios,
         (SELECT COALESCE(SUM(td.comision_monto), 0)
          FROM ticket_detalles td
          JOIN tickets t ON t.id = td.ticket_id
          WHERE t.banca_id = $1 AND t.anulado = false AND ($2::date IS NULL OR t.fecha = $2))  AS total_comision,
         (SELECT COUNT(gl.id)
          FROM ganadores_loteria gl
          JOIN tickets t ON t.id = gl.ticket_id
          WHERE t.banca_id = $1 AND t.anulado = false AND gl.pagado = false
            AND ($2::date IS NULL OR t.fecha = $2))                                            AS premios_pendientes`,
      [bancaFiltro, f]
    );

    const r  = resResumen.rows[0];
    const v  = parseFloat(r.total_venta    || 0);
    const c  = parseFloat(r.total_comision || 0);
    const p  = parseFloat(r.total_premios  || 0);

    // ── DETALLE POR MODALIDAD ────────────────────────
    const resMod = await query(
      `SELECT
         td.modalidad,
         COUNT(DISTINCT t.id)                AS tickets,
         COALESCE(SUM(td.monto), 0)          AS monto_total,
         MAX(td.comision_pct)                AS comision_pct,
         COALESCE(SUM(td.comision_monto), 0) AS comision_total
       FROM ticket_detalles td
       JOIN tickets t ON t.id = td.ticket_id
       WHERE t.banca_id = $1
         AND t.anulado  = false
         AND ($2::date IS NULL OR t.fecha = $2)
       GROUP BY td.modalidad
       ORDER BY CASE td.modalidad WHEN 'Q' THEN 1 WHEN 'P' THEN 2 WHEN 'T' THEN 3 WHEN 'SP' THEN 4 ELSE 5 END`,
      [bancaFiltro, f]
    );

    // ── DETALLE POR LOTERÍA ──────────────────────────
    // La lotería viene de tickets → jornadas → loterias (ticket_detalles NO tiene loteria_id)
    const resLot = await query(
      `SELECT
         l.nombre                                          AS loteria_nombre,
         COALESCE(SUM(td.monto), 0)                       AS monto_total,
         COALESCE(SUM(td.comision_monto), 0)              AS comision_total,
         COALESCE((
           SELECT SUM(gl.monto)
           FROM ganadores_loteria gl
           JOIN tickets t2 ON t2.id = gl.ticket_id
           WHERE t2.banca_id   = $1
             AND t2.anulado    = false
             AND gl.jornada_id = j.id
             AND ($2::date IS NULL OR t2.fecha = $2)
         ), 0)                                            AS premios_total
       FROM ticket_detalles td
       JOIN tickets  t ON t.id  = td.ticket_id
       JOIN jornadas j ON j.id  = t.jornada_id
       JOIN loterias l ON l.id  = j.loteria_id
       WHERE t.banca_id = $1
         AND t.anulado  = false
         AND ($2::date IS NULL OR t.fecha = $2)
       GROUP BY l.id, l.nombre, j.id
       ORDER BY l.nombre`,
      [bancaFiltro, f]
    );

    res.json({
      resumen: {
        total_tickets:    parseInt(r.total_tickets    || 0),
        tickets_anulados: parseInt(r.tickets_anulados || 0),
        total_venta:      v,
        total_premios:    p,
        total_comision:   c,
        resultado:        v - c - p,
        premios_pendientes: parseInt(r.premios_pendientes || 0)
      },
      por_modalidad: resMod.rows || [],
      por_loteria:   resLot.rows || []
    });

  } catch (err) {
    console.error('ERROR en reporte banca:', err.message);
    res.status(500).json({ error: 'Error en base de datos: ' + err.message });
  }
});

// ======================================================
// GET /api/reportes/exposicion
// ======================================================
router.get('/exposicion', requireRol('admin', 'central'), async (req, res) => {
  const { jornada_id } = req.query;
  if (!jornada_id) return res.status(400).json({ error: 'jornada_id es requerido' });
  try {
    const global = await query(
      `SELECT modalidad, numero, monto_acumulado FROM exposicion_global WHERE jornada_id = $1 ORDER BY monto_acumulado DESC`,
      [jornada_id]
    );
    const porBanca = await query(
      `SELECT b.nombre AS banca, eb.modalidad, eb.numero, eb.monto_acumulado
       FROM exposicion_banca eb JOIN bancas b ON b.id = eb.banca_id
       WHERE eb.jornada_id = $1 ORDER BY eb.monto_acumulado DESC`,
      [jornada_id]
    );
    res.json({ global: global.rows, por_banca: porBanca.rows });
  } catch (err) {
    console.error('Error reporte exposicion:', err);
    res.status(500).json({ error: 'Error al obtener exposición' });
  }
});

module.exports = router;
