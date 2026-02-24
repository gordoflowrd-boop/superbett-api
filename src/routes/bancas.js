const express = require('express');
const { query } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/bancas/config
// Devuelve la configuración de la banca del vendedor:
// precios por modalidad, límites, nombre.
// El vendedor lo llama al cargar el POS para tener los precios localmente.
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

    res.json({
      banca: {
        id:            banca.id,
        nombre:        banca.nombre,
        codigo:        banca.codigo,
        nombre_ticket: banca.nombre_ticket,
        limite_q:      banca.limite_q,
        limite_p:      banca.limite_p,
        limite_t:      banca.limite_t,
        limite_sp:     banca.limite_sp,
      },
      precios,
    });

  } catch (err) {
    console.error('Error banca config:', err);
    res.status(500).json({ error: 'Error al obtener configuración de banca' });
  }
});

module.exports = router;
