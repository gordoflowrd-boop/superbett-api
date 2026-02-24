const express = require('express');
const { query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ======================================================
// GET /api/reportes/ganadores?fecha=&loteria_id=
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
// GET /api/reportes/resumen?fecha=
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

  if (!bancaFiltro) {
    return res.status(400).json({ error: 'banca_id es requerido' });
  }

  try {
    // 1. RESUMEN GENERAL (Optimizado con subconsultas para evitar duplicados por JOIN)
    const resumenQuery = await query(
      `SELECT
         COUNT(t.id) FILTER (WHERE t.anulado = false)                         AS total_tickets,
         COUNT(t.id) FILTER (WHERE t.anulado = true)                          AS tickets_anulados,
         COALESCE(SUM(t.total_monto) FILTER (WHERE t.anulado = false), 0)     AS total_venta,
         -- Premios calculados de forma independiente para evitar duplicidad
         COALESCE((
           SELECT SUM(gl.monto) 
           FROM ganadores_loteria gl 
           JOIN tickets t2 ON t2.id = gl.ticket_id 
           WHERE t2.banca_id = $1 AND ($2::date IS NULL OR t2.fecha = $2)
         ), 0) AS total_premios,
         -- Comisiones calculadas desde los detalles
         COALESCE((
           SELECT SUM(td2.comision_monto) 
           FROM ticket_detalles td2 
           JOIN tickets t3 ON t3.id = td2.ticket_id 
           WHERE t3.banca_id = $1 AND t3.anulado = false AND ($2::date IS NULL OR t3.fecha = $2)
         ), 0) AS total_comision,
         -- Conteo de premios sin pagar
         COALESCE((
           SELECT COUNT(gl2.id) 
           FROM ganadores_loteria gl2 
           JOIN tickets t4 ON t4.id = gl2.ticket_id 
           WHERE t4.banca_id = $1 AND gl2.pagado = false AND ($2::date IS NULL OR t4.fecha = $2)
         ), 0) AS premios_pendientes
       FROM tickets t
       WHERE t.banca_id = $1
         AND ($2::date IS NULL OR t.fecha = $2)`,
      [bancaFiltro, fecha || null]
    );

    const r = resumenQuery.rows[0];
    
    // Calculamos el resultado neto final: Venta - Comisión - Premios
    const resultadoNeto = Number(r.total_venta) - Number(r.total_comision) - Number(r.total_premios);

    // 2. DETALLE POR MODALIDAD
    const detalle = await query(
      `SELECT
         td.modalidad,
         COUNT(DISTINCT t.id)                AS tickets,
         SUM(td.cantidad)                    AS jugadas,
         COALESCE(SUM(td.monto), 0)          AS monto_total,
         MAX(td.comision_pct)                AS comision_pct,
         COALESCE(SUM(td.comision_monto), 0) AS comision_total
       FROM ticket_detalles td
       JOIN tickets t ON t.id = td.ticket_id
       WHERE t.banca_id = $1
         AND t.anulado  = false
         AND ($2::date IS NULL OR t.fecha = $2)
       GROUP BY td.modalidad
       ORDER BY td.modalidad`,
      [bancaFiltro, fecha || null]
    );

    res.json({
      resumen: {
        total_tickets:      parseInt(r.total_tickets),
        tickets_anulados:   parseInt(r.tickets_anulados),
        total_venta:        parseFloat(r.total_venta),
        total_premios:      parseFloat(r.total_premios),
        total_comision:     parseFloat(r.total_comision),
        resultado:          resultadoNeto,
        premios_pendientes: parseInt(r.premios_pendientes)
      },
      por_modalidad: detalle.rows || []
    });

  } catch (err) {
    console.error('Error reporte banca:', err);
    res.status(500).json({ error: 'Error al obtener reporte de banca' });
  }
});

// ======================================================
// GET /api/reportes/exposicion?jornada_id=
// ======================================================
router.get('/exposicion', requireRol('admin', 'central'), async (req, res) => {
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
      `SELECT b.nombre AS banca, eb.modalidad, eb.numero, eb.monto_acumulado
       FROM exposicion_banca eb
       JOIN bancas b ON b.id = eb.banca_id
       WHERE eb.jornada_id = $1
       ORDER BY eb.monto_acumulado DESC`,
      [jornada_id]
    );
    res.json({ global: global.rows, por_banca: porBanca.rows });
  } catch (err) {
    console.error('Error reporte exposicion:', err);
    res.status(500).json({ error: 'Error al obtener exposición' });
  }
});

module.exports = router;
