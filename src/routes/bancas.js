const express = require('express');
const { query } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/bancas/config
// Devuelve la configuración de la banca del vendedor:
// precios por modalidad, límites, nombre y tiempo_anulacion global.
router.get('/config', async (req, res) => {
  const banca_id = req.usuario.banca_id;

  if (!banca_id) {
    return res.status(400).json({ error: 'Usuario no tiene banca asignada' });
  }

  try {
    // Datos de la banca
    const bancaRes = await query(
      `SELECT b.id, b.nombre, b.codigo, b.nombre_ticket,
              b.esquema_precio_id, b.esquema_pago_id,
              b.limite_q, b.limite_p, b.limite_t, b.limite_sp
       FROM bancas b
       WHERE b.id = $1`,
      [banca_id]
    );

    if (!bancaRes.rows.length) {
      return res.status(404).json({ error: 'Banca no encontrada' });
    }

    const banca = bancaRes.rows[0];

    // Precios por modalidad y lotería
    let precios = [];
    if (banca.esquema_precio_id) {
      const preciosRes = await query(
        `SELECT modalidad, loteria_id, precio
         FROM esquema_precios_detalle
         WHERE esquema_id = $1`,
        [banca.esquema_precio_id]
      );
      precios = preciosRes.rows;
    }

    // Configuración global (tiempo límite de anulación)
    const cfgRes = await query(
      `SELECT tiempo_anulacion FROM configuracion WHERE id = 1`
    );
    const tiempo_anulacion = cfgRes.rows.length
      ? (cfgRes.rows[0].tiempo_anulacion ?? 0)
      : 0;

    res.json({
      banca: {
        id:               banca.id,
        nombre:           banca.nombre,
        codigo:           banca.codigo,
        nombre_ticket:    banca.nombre_ticket,
        limite_q:         banca.limite_q,
        limite_p:         banca.limite_p,
        limite_t:         banca.limite_t,
        limite_sp:        banca.limite_sp,
        tiempo_anulacion,  // ← nuevo
      },
      precios,
    });

  } catch (err) {
    console.error('Error banca config:', err);
    res.status(500).json({ error: 'Error al obtener configuración de banca' });
  }
});

// PUT /api/bancas/config/tiempo-anulacion
// Solo admin. Actualiza el tiempo límite global de anulación.
router.put('/config/tiempo-anulacion', async (req, res) => {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  const { tiempo_anulacion } = req.body;

  if (tiempo_anulacion === undefined || tiempo_anulacion === null) {
    return res.status(400).json({ error: 'Campo tiempo_anulacion requerido' });
  }

  const minutos = parseInt(tiempo_anulacion, 10);
  if (isNaN(minutos) || minutos < 0) {
    return res.status(400).json({ error: 'tiempo_anulacion debe ser un número >= 0' });
  }

  try {
    await query(
      `UPDATE configuracion SET tiempo_anulacion = $1 WHERE id = 1`,
      [minutos]
    );
    res.json({ ok: true, tiempo_anulacion: minutos });
  } catch (err) {
    console.error('Error actualizando tiempo_anulacion:', err);
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

module.exports = router;
