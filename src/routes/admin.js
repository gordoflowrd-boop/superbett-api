const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(requireRol('admin'));

// =============================================
// USUARIOS
// =============================================

// GET /api/admin/usuarios
router.get('/usuarios', async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.nombre, u.rol, u.activo, u.created_at,
              jsonb_agg(DISTINCT jsonb_build_object(
                'banca_id', b.id, 'banca', b.nombre, 'modalidad', ub.modalidad,
                'bruto', ub.porcentaje_bruto, 'neto', ub.porcentaje_neto
              )) FILTER (WHERE b.id IS NOT NULL) AS bancas
       FROM usuarios u
       LEFT JOIN usuarios_bancas ub ON ub.usuario_id = u.id
       LEFT JOIN bancas b ON b.id = ub.banca_id
       GROUP BY u.id
       ORDER BY u.username`
    );
    res.json({ usuarios: result.rows });
  } catch (err) {
    console.error('Error listado usuarios:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// POST /api/admin/usuarios
router.post('/usuarios', async (req, res) => {
  const { username, password, nombre, rol } = req.body;

  if (!username || !password || !rol) {
    return res.status(400).json({ error: 'username, password y rol son requeridos' });
  }
  if (!['admin','central','rifero','vendedor'].includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO usuarios (username, password, nombre, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, nombre, rol, activo, created_at`,
      [username.trim().toLowerCase(), hash, nombre || null, rol]
    );
    res.status(201).json({ usuario: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El username ya existe' });
    }
    console.error('Error crear usuario:', err);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// PATCH /api/admin/usuarios/:id
router.patch('/usuarios/:id', async (req, res) => {
  const { nombre, rol, activo, password } = req.body;
  const { id } = req.params;

  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await query('UPDATE usuarios SET password = $1, updated_at = now() WHERE id = $2', [hash, id]);
    }
    if (nombre !== undefined || rol !== undefined || activo !== undefined) {
      await query(
        `UPDATE usuarios SET
           nombre     = COALESCE($1, nombre),
           rol        = COALESCE($2, rol),
           activo     = COALESCE($3, activo),
           updated_at = now()
         WHERE id = $4`,
        [nombre || null, rol || null, activo !== undefined ? activo : null, id]
      );
    }
    res.json({ estado: 'ok', mensaje: 'Usuario actualizado' });
  } catch (err) {
    console.error('Error actualizar usuario:', err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// POST /api/admin/usuarios/:id/bancas — asignar comisión usuario-banca
router.post('/usuarios/:id/bancas', async (req, res) => {
  const { banca_id, modalidad, porcentaje_bruto, porcentaje_neto } = req.body;

  if (!banca_id || !modalidad) {
    return res.status(400).json({ error: 'banca_id y modalidad son requeridos' });
  }

  try {
    await query(
      `INSERT INTO usuarios_bancas (usuario_id, banca_id, modalidad, porcentaje_bruto, porcentaje_neto)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (usuario_id, banca_id, modalidad) DO UPDATE
         SET porcentaje_bruto = EXCLUDED.porcentaje_bruto,
             porcentaje_neto  = EXCLUDED.porcentaje_neto`,
      [req.params.id, banca_id, modalidad, porcentaje_bruto || 0, porcentaje_neto || 0]
    );
    res.json({ estado: 'ok', mensaje: 'Comisión asignada' });
  } catch (err) {
    console.error('Error asignar banca:', err);
    res.status(500).json({ error: 'Error al asignar banca' });
  }
});

// =============================================
// BANCAS
// =============================================

// GET /api/admin/bancas
router.get('/bancas', async (req, res) => {
  try {
    const result = await query(
      `SELECT b.*, ep.nombre AS esquema_precio, epg.nombre AS esquema_pago
       FROM bancas b
       LEFT JOIN esquema_precios  ep  ON ep.id  = b.esquema_precio_id
       LEFT JOIN esquema_pagos    epg ON epg.id = b.esquema_pago_id
       ORDER BY b.nombre`
    );
    res.json({ bancas: result.rows });
  } catch (err) {
    console.error('Error listado bancas:', err);
    res.status(500).json({ error: 'Error al obtener bancas' });
  }
});

// POST /api/admin/bancas
router.post('/bancas', async (req, res) => {
  const { nombre, codigo, nombre_ticket, esquema_precio_id, esquema_pago_id,
          limite_q, limite_p, limite_t, limite_sp } = req.body;

  if (!nombre || !codigo || !nombre_ticket) {
    return res.status(400).json({ error: 'nombre, codigo y nombre_ticket son requeridos' });
  }

  try {
    const result = await query(
      `INSERT INTO bancas
         (nombre, codigo, nombre_ticket, esquema_precio_id, esquema_pago_id,
          limite_q, limite_p, limite_t, limite_sp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [nombre, codigo.toUpperCase(), nombre_ticket,
       esquema_precio_id || null, esquema_pago_id || null,
       limite_q || null, limite_p || null, limite_t || null, limite_sp || null]
    );
    res.status(201).json({ banca: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El código de banca ya existe' });
    }
    console.error('Error crear banca:', err);
    res.status(500).json({ error: 'Error al crear banca' });
  }
});

// PATCH /api/admin/bancas/:id
router.patch('/bancas/:id', async (req, res) => {
  const { nombre, nombre_ticket, esquema_precio_id, esquema_pago_id,
          limite_q, limite_p, limite_t, limite_sp, activa } = req.body;
  try {
    await query(
      `UPDATE bancas SET
         nombre            = COALESCE($1,  nombre),
         nombre_ticket     = COALESCE($2,  nombre_ticket),
         esquema_precio_id = COALESCE($3,  esquema_precio_id),
         esquema_pago_id   = COALESCE($4,  esquema_pago_id),
         limite_q          = COALESCE($5,  limite_q),
         limite_p          = COALESCE($6,  limite_p),
         limite_t          = COALESCE($7,  limite_t),
         limite_sp         = COALESCE($8,  limite_sp),
         activa            = COALESCE($9,  activa),
         updated_at        = now()
       WHERE id = $10`,
      [nombre, nombre_ticket, esquema_precio_id, esquema_pago_id,
       limite_q, limite_p, limite_t, limite_sp, activa, req.params.id]
    );
    res.json({ estado: 'ok', mensaje: 'Banca actualizada' });
  } catch (err) {
    console.error('Error actualizar banca:', err);
    res.status(500).json({ error: 'Error al actualizar banca' });
  }
});

// =============================================
// LOTERÍAS
// =============================================

// GET /api/admin/loterias
router.get('/loterias', async (req, res) => {
  try {
    const result = await query(
      `SELECT l.*, lh.hora_inicio, lh.hora_cierre
       FROM loterias l
       LEFT JOIN loteria_horarios lh ON lh.loteria_id = l.id
       ORDER BY l.orden, l.nombre`
    );
    res.json({ loterias: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener loterías' });
  }
});

// POST /api/admin/loterias
router.post('/loterias', async (req, res) => {
  const { nombre, codigo, zona_horaria, orden, hora_inicio, hora_cierre } = req.body;

  if (!nombre || !codigo) {
    return res.status(400).json({ error: 'nombre y codigo son requeridos' });
  }

  try {
    const lot = await query(
      `INSERT INTO loterias (nombre, codigo, zona_horaria, orden)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [nombre, codigo.toUpperCase(),
       zona_horaria || 'America/Santo_Domingo', orden || 0]
    );
    const loteria_id = lot.rows[0].id;

    if (hora_inicio && hora_cierre) {
      await query(
        `INSERT INTO loteria_horarios (loteria_id, hora_inicio, hora_cierre)
         VALUES ($1, $2, $3)
         ON CONFLICT (loteria_id) DO UPDATE
           SET hora_inicio = $2, hora_cierre = $3`,
        [loteria_id, hora_inicio, hora_cierre]
      );
    }

    res.status(201).json({ estado: 'ok', id: loteria_id });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El código de lotería ya existe' });
    }
    console.error('Error crear lotería:', err);
    res.status(500).json({ error: 'Error al crear lotería' });
  }
});

// =============================================
// ESQUEMAS DE PRECIOS Y PAGOS
// =============================================

// GET /api/admin/esquemas/precios
router.get('/esquemas/precios', async (req, res) => {
  try {
    const result = await query(
      `SELECT ep.id, ep.nombre, ep.activo,
              jsonb_agg(jsonb_build_object(
                'modalidad', epd.modalidad,
                'loteria_id', epd.loteria_id,
                'precio', epd.precio
              ) ORDER BY epd.modalidad) AS detalle
       FROM esquema_precios ep
       LEFT JOIN esquema_precios_detalle epd ON epd.esquema_id = ep.id
       GROUP BY ep.id ORDER BY ep.nombre`
    );
    res.json({ esquemas: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener esquemas de precios' });
  }
});

// GET /api/admin/esquemas/pagos
router.get('/esquemas/pagos', async (req, res) => {
  try {
    const result = await query(
      `SELECT ep.id, ep.nombre, ep.activo,
              jsonb_agg(jsonb_build_object(
                'modalidad', epd.modalidad,
                'posicion',  epd.posicion,
                'loteria_id', epd.loteria_id,
                'pago', epd.pago
              ) ORDER BY epd.modalidad, epd.posicion) AS detalle
       FROM esquema_pagos ep
       LEFT JOIN esquema_pagos_detalle epd ON epd.esquema_id = ep.id
       GROUP BY ep.id ORDER BY ep.nombre`
    );
    res.json({ esquemas: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener esquemas de pagos' });
  }
});

module.exports = router;
