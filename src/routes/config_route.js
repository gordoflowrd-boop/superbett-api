const express = require('express');
const { query } = require('../db');

const router = express.Router();

// =============================================
// CONFIGURACIÓN POR BANCA — PÚBLICO (sin JWT)
// Autenticación: codigo + ip_config
// GET /api/config/:codigo?ip=192.168.1.10
// =============================================

router.get('/:codigo', async (req, res) => {
  const codigo = req.params.codigo.trim().toUpperCase();

  // IP: primero del query param, luego del header (proxy), luego socket
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

    // Banca no existe
    if (!r.rows.length) {
      return res.status(404).json({ error: 'Banca no encontrada' });
    }

    const banca = r.rows[0];

    // IP no configurada en la banca
    if (!banca.ip_config) {
      return res.status(403).json({
        error: 'Esta banca no tiene IP configurada. Contacte al administrador.'
      });
    }

    // IP no coincide
    if (banca.ip_config.trim() !== ip) {
      return res.status(403).json({
        error: 'IP no autorizada para esta banca.'
      });
    }

    // Todo OK — devolver config completa (sin ip_config por seguridad)
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
