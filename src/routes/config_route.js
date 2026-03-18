const express = require('express');
const { query } = require('../db');

const router = express.Router();

// GET /api/config/central — público, devuelve nombre y mensaje_login
router.get('/central', async (req, res) => {
  try {
    const result = await query(
      `SELECT clave, valor FROM central_config WHERE clave IN ('nombre_central','mensaje_login')`
    );
    const config = {};
    result.rows.forEach(r => { config[r.clave] = r.valor ?? ''; });
    if (!config.nombre_central) config.nombre_central = 'SuperBett';
    if (!config.mensaje_login)  config.mensaje_login  = '';
    res.json({ config });
  } catch (err) {
    // Si la tabla no existe aún, devolver defaults
    res.json({ config: { nombre_central: 'SuperBett', mensaje_login: '' } });
  }
});

// GET /api/config/:codigo?ip=192.168.1.10 — público, validación banca
router.get('/:codigo', async (req, res) => {
  const codigo = req.params.codigo.trim().toUpperCase();

  const ip = (
    req.query.ip ||
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress ||
    ''
  ).trim();

  if (!codigo) {
    return res.status(400).json({ error: 'codigo es requerido' });
  }

  if (!ip) {
    return res.status(400).json({ error: 'IP es requerida' });
  }

  try {
    const r = await query(
      `SELECT
         b.id, b.nombre, b.codigo, b.nombre_ticket, b.activa,
         b.ip_config,
         b.esquema_precio_id, b.esquema_pago_id,
         b.limite_q, b.limite_p, b.limite_t, b.limite_sp,
         b.tope_q,   b.tope_p,   b.tope_t,   b.tope_sp,
         c.valor AS tiempo_anulacion
       FROM bancas b
       LEFT JOIN configuracion c ON c.clave = 'tiempo_anulacion'
       WHERE b.codigo = $1 AND b.activa = true`,
      [codigo]
    );

    if (!r.rows.length) {
      return res.status(404).json({ error: 'Banca no encontrada' });
    }

    const banca = r.rows[0];

    if (!banca.ip_config) {
      return res.status(403).json({
        error: 'Esta banca no tiene IP configurada. Contacte al administrador.'
      });
    }

    if (banca.ip_config.trim() !== ip) {
      return res.status(403).json({
        error: 'IP no autorizada para esta banca.'
      });
    }

    const { ip_config, ...config } = banca;

    res.json({
      estado: 'ok',
      config: {
        ...config,
        tiempo_anulacion: parseInt(config.tiempo_anulacion ?? '5', 10),
      }
    });

  } catch (err) {
    console.error('Error config banca:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;