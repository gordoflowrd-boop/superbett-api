const express = require('express');
const { query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ======================================================
// GET /api/reportes/ganadores?fecha=&loteria_id=
// Solo admin / central / rifero
// ======================================================
router.get(
  '/ganadores',
  requireRol('admin', 'central', 'rifero'),
  async (req, res) => {
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
  }
);

// ======================================================
// GET /api/reportes/resumen?fecha=
// Solo admin / central
// ======================================================
router.get(
  '/resumen',
  requireRol('admin', 'central'),
  async (req, res) => {
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
  }
);

// ======================================================
// GET /api/reportes/banca?fecha=&banca_id=
// Admin puede consultar cualquier banca
// Vendedor solo su propia banca
// ======================================================
router.get(
  '/banca',
  requireRol('admin', 'central', 'rifero', 'vendedor'),
  async (req, res) => {

    const { banca_id, fecha } = req.query;

    // 🔐 Seguridad: vendedor solo su banca
    const bancaFiltro =
      req.usuario.rol === 'vendedor'
        ? req.usuario.banca_id
        : banca_id;

    if (!bancaFiltro) {
      return res.status(400).json({ error: 'banca_id es requerido' });
    }

    try {

      // -------- RESUMEN --------
      const resumen = await query(
        `SELECT
           COUNT(t.id) FILTER (WHERE t.anulado = false) AS total_tickets,
           COUNT(t.id) FILTER (WHERE t.anulado = true)  AS tickets_anulados,
           COALESCE(SUM(t.total_monto) FILTER (WHERE t.anulado = false), 0) AS total_venta,
           COALESCE(SUM(g.monto), 0) AS total_premios,
           COALESCE(SUM(t.total_monto) FILTER (WHERE t.anulado = false), 0)
             - COALESCE(SUM(g.monto), 0) AS resultado,
           COUNT(g.id) FILTER (
             WHERE g.pagado = false AND g.id IS NOT NULL
           ) AS premios_pendientes
         FROM tickets t
         LEFT JOIN ganadores_loteria g ON g.ticket_id = t.id
         WHERE t.banca_id = $1
           AND ($2::date IS NULL OR t.fecha = $2)`,
        [bancaFiltro, fecha || null]
      );

      // -------- DETALLE POR MODALIDAD --------
      const detalle = await query(
        `SELECT
           td.modalidad,
           COUNT(DISTINCT t.id) AS tickets,
           SUM(td.cantidad)     AS jugadas,
           COALESCE(SUM(td.monto), 0) AS monto_total
         FROM ticket_detalles td
         JOIN tickets t ON t.id = td.ticket_id
         WHERE t.banca_id = $1
           AND t.anulado = false
           AND ($2::date IS NULL OR t.fecha = $2)
         GROUP BY td.modalidad
         ORDER BY td.modalidad`,
        [bancaFiltro, fecha || null]
      );

      res.json({
        resumen: resumen.rows[0] || {
          total_tickets: 0,
          tickets_anulados: 0,
          total_venta: 0,
          total_premios: 0,
          resultado: 0,
          premios_pendientes: 0
        },
        por_modalidad: detalle.rows || []
      });

    } catch (err) {
      console.error('Error reporte banca:', err);
      res.status(500).json({ error: 'Error al obtener reporte de banca' });
    }
  }
);

// ======================================================
// GET /api/reportes/exposicion?jornada_id=
// Solo admin / central
// ======================================================
router.get(
  '/exposicion',
  requireRol('admin', 'central'),
  async (req, res) => {

    const { jornada_id } = req.query;

    if (!jornada_id) {
      return res.status(400).json({ error: 'jornada_id es requerido' });
    }

    try {

      const global = await query(
        `SELECT modalidad, numero, monto_acumulado
         FROM exposicion_global
         WHERE jornada_id = $1
         ORDER BY monto_acumulado DESC`,
        [jornada_id]
      );

      const porBanca = await query(
        `SELECT b.nombre AS banca,
                eb.modalidad,
                eb.numero,
                eb.monto_acumulado
         FROM exposicion_banca eb
         JOIN bancas b ON b.id = eb.banca_id
         WHERE eb.jornada_id = $1
         ORDER BY eb.monto_acumulado DESC`,
        [jornada_id]
      );

      res.json({
        global: global.rows,
        por_banca: porBanca.rows
      });

    } catch (err) {
      console.error('Error reporte exposicion:', err);
      res.status(500).json({ error: 'Error al obtener exposición' });
    }
  }
);

module.exports = router;