const express = require('express');
const { query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/jornadas/abiertas
router.get('/abiertas', async (req, res) => {
  try {
    const result = await query('SELECT jornadas_abiertas($1)', [req.query.fecha || null]);
    res.json(result.rows[0].jornadas_abiertas);
  } catch (err) {
    console.error('Error jornadas_abiertas:', err);
    res.status(500).json({ error: 'Error al obtener jornadas' });
  }
});

// GET /api/jornadas/incompletas  [admin]
router.get('/incompletas', requireRol('admin', 'central'), async (req, res) => {
  try {
    const result = await query('SELECT jornadas_incompletas()');
    res.json(result.rows[0].jornadas_incompletas);
  } catch (err) {
    console.error('Error jornadas_incompletas:', err);
    res.status(500).json({ error: 'Error al obtener jornadas incompletas' });
  }
});

// GET /api/jornadas?fecha=  [admin]
router.get('/', requireRol('admin', 'central'), async (req, res) => {
  const { fecha } = req.query;
  try {
    const result = await query(
      `SELECT j.id, j.fecha, j.hora_inicio, j.hora_cierre, j.estado,
              l.nombre AS loteria, l.zona_horaria,
              COUNT(t.id) FILTER (WHERE t.anulado = false) AS total_tickets,
              COALESCE(SUM(t.total_monto) FILTER (WHERE t.anulado = false), 0) AS total_venta,
              p.q1, p.q2, p.q3, p.activo AS premio_activo
       FROM jornadas j
       JOIN loterias l ON l.id = j.loteria_id
       LEFT JOIN tickets t ON t.jornada_id = j.id
       LEFT JOIN premios p ON p.jornada_id = j.id
       WHERE ($1::date IS NULL OR j.fecha = $1::date)
       GROUP BY j.id, l.nombre, l.zona_horaria, p.q1, p.q2, p.q3, p.activo
       ORDER BY j.fecha DESC, j.hora_inicio`,
      [fecha || null]
    );
    res.json({ jornadas: result.rows });
  } catch (err) {
    console.error('Error listado jornadas:', err);
    res.status(500).json({ error: 'Error al obtener jornadas' });
  }
});

// POST /api/jornadas/generar  [admin]
router.post('/generar', requireRol('admin'), async (req, res) => {
  const { fecha } = req.body;
  try {
    const result = await query('SELECT generar_jornadas($1)', [fecha || null]);
    res.json(result.rows[0].generar_jornadas);
  } catch (err) {
    console.error('Error generar_jornadas:', err);
    res.status(500).json({ error: 'Error al generar jornadas' });
  }
});

// POST /api/jornadas/:id/cerrar  [admin]
router.post('/:id/cerrar', requireRol('admin', 'central'), async (req, res) => {
  try {
    const result = await query('SELECT cerrar_jornada($1)', [req.params.id]);
    res.json(result.rows[0].cerrar_jornada);
  } catch (err) {
    console.error('Error cerrar_jornada:', err);
    res.status(500).json({ error: 'Error al cerrar jornada' });
  }
});

// POST /api/jornadas/:id/reabrir  [admin]
router.post('/:id/reabrir', requireRol('admin'), async (req, res) => {
  try {
    const result = await query('SELECT reabrir_jornada($1)', [req.params.id]);
    res.json(result.rows[0].reabrir_jornada);
  } catch (err) {
    console.error('Error reabrir_jornada:', err);
    res.status(500).json({ error: 'Error al reabrir jornada' });
  }
});

// PATCH /api/jornadas/:id  — actualizar estado y/o horario  [admin]
router.patch('/:id', requireRol('admin', 'central'), async (req, res) => {
  const { estado, hora_inicio, hora_cierre } = req.body;
  const valid = ['abierto', 'cerrado', 'completado', 'finalizado'];
  if (estado && !valid.includes(estado))
    return res.status(400).json({ error: 'Estado inválido' });
  try {
    await query(
      `UPDATE jornadas SET
         estado      = COALESCE($1, estado),
         hora_inicio = COALESCE($2::time, hora_inicio),
         hora_cierre = COALESCE($3::time, hora_cierre)
       WHERE id = $4`,
      [estado || null, hora_inicio || null, hora_cierre || null, req.params.id]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error actualizar jornada:', err);
    res.status(500).json({ error: 'Error al actualizar jornada' });
  }
});

module.exports = router;
