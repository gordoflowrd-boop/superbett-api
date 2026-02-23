const express = require('express');
const { query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(requireRol('admin', 'central'));

// =============================================
// POST /api/premios/registrar
// Guardar números ganadores sin activar (permite corrección)
// Body: { jornada_id, q1, q2, q3 }
// =============================================
router.post('/registrar', async (req, res) => {
  const { jornada_id, q1, q2, q3 } = req.body;

  if (!jornada_id || q1 === undefined || q2 === undefined || q3 === undefined) {
    return res.status(400).json({ error: 'jornada_id, q1, q2 y q3 son requeridos' });
  }

  const nums = [q1, q2, q3];
  for (const n of nums) {
    if (!Number.isInteger(Number(n)) || n < 0 || n > 99) {
      return res.status(400).json({ error: 'Los números deben estar entre 00 y 99' });
    }
  }

  try {
    const result = await query(
      'SELECT registrar_premio($1, $2, $3, $4)',
      [jornada_id, Number(q1), Number(q2), Number(q3)]
    );
    res.json(result.rows[0].registrar_premio);
  } catch (err) {
    console.error('Error registrar_premio:', err);
    res.status(500).json({ error: 'Error al registrar el premio' });
  }
});

// =============================================
// POST /api/premios/activar
// Activar premio → dispara el motor de ganadores automáticamente
// Body: { jornada_id }
// =============================================
router.post('/activar', async (req, res) => {
  const { jornada_id } = req.body;

  if (!jornada_id) {
    return res.status(400).json({ error: 'jornada_id es requerido' });
  }

  try {
    const result = await query(
      'SELECT activar_premio($1)',
      [jornada_id]
    );
    res.json(result.rows[0].activar_premio);
  } catch (err) {
    console.error('Error activar_premio:', err);
    res.status(500).json({ error: 'Error al activar el premio' });
  }
});

// =============================================
// GET /api/premios?fecha=&loteria_id=
// Ver premios registrados
// =============================================
router.get('/', async (req, res) => {
  const { fecha, loteria_id } = req.query;

  try {
    const result = await query(
      `SELECT p.id, p.jornada_id, p.q1, p.q2, p.q3, p.activo, p.created_at,
              j.fecha, j.hora_inicio, j.hora_cierre, j.estado AS jornada_estado,
              l.nombre AS loteria
       FROM premios p
       JOIN jornadas j  ON j.id  = p.jornada_id
       JOIN loterias l  ON l.id  = j.loteria_id
       WHERE ($1::date IS NULL OR j.fecha       = $1)
         AND ($2::uuid IS NULL OR j.loteria_id  = $2)
       ORDER BY j.fecha DESC, j.hora_cierre`,
      [fecha || null, loteria_id || null]
    );
    res.json({ premios: result.rows });
  } catch (err) {
    console.error('Error listado premios:', err);
    res.status(500).json({ error: 'Error al obtener premios' });
  }
});

module.exports = router;
