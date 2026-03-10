const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();

// Middleware de seguridad: Solo admins y usuarios de central
router.use(authMiddleware);
router.use(requireRol('admin', 'central'));

// =============================================
// 1. GESTIÓN DE USUARIOS
// =============================================

// Listar usuarios con sus bancas asignadas
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

// Crear usuario
router.post('/usuarios', async (req, res) => {
  const { username, password, nombre, rol } = req.body;
  if (!username || !password || !rol) return res.status(400).json({ error: 'Datos incompletos' });
  
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO usuarios (username, password, nombre, rol)
       VALUES ($1, $2, $3, $4) RETURNING id, username, nombre, rol, activo`,
      [username.trim().toLowerCase(), hash, nombre || null, rol]
    );
    res.status(201).json({ usuario: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'El username ya existe' });
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// Actualizar usuario (incluye cambio de password y estado)
router.patch('/usuarios/:id', async (req, res) => {
  const { nombre, username, rol, activo, password, password_actual } = req.body;
  const { id } = req.params;
  const esPropio = String(req.usuario.id) === String(id);

  try {
    if (password) {
      if (esPropio) {
        if (!password_actual) return res.status(400).json({ error: 'Contraseña actual requerida' });
        const userRes = await query('SELECT password FROM usuarios WHERE id = $1', [id]);
        const ok = await bcrypt.compare(password_actual, userRes.rows[0].password);
        if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
      }
      const hash = await bcrypt.hash(password, 10);
      await query('UPDATE usuarios SET password = $1 WHERE id = $2', [hash, id]);
    }

    await query(
      `UPDATE usuarios SET
         nombre   = COALESCE($1, nombre),
         username = COALESCE($2, username),
         rol      = COALESCE($3, rol),
         activo   = COALESCE($4, activo),
         updated_at = now()
       WHERE id = $5`,
      [nombre, username?.toLowerCase(), rol, activo, id]
    );
    res.json({ estado: 'ok', mensaje: 'Usuario actualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// Asignar comisiones personalizadas a un usuario por banca
router.post('/usuarios/:id/bancas', async (req, res) => {
  const { banca_id, modalidad, porcentaje_bruto, porcentaje_neto } = req.body;
  try {
    await query(
      `INSERT INTO usuarios_bancas (usuario_id, banca_id, modalidad, porcentaje_bruto, porcentaje_neto)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (usuario_id, banca_id, modalidad) 
       DO UPDATE SET porcentaje_bruto = EXCLUDED.porcentaje_bruto, porcentaje_neto = EXCLUDED.porcentaje_neto`,
      [req.params.id, banca_id, modalidad, porcentaje_bruto || 0, porcentaje_neto || 0]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Error al asignar comisión' });
  }
});

// =============================================
// 2. GESTIÓN DE BANCAS
// =============================================

router.get('/bancas', async (req, res) => {
  try {
    const result = await query(
      `SELECT b.*, ep.nombre AS esquema_precio, epg.nombre AS esquema_pago
       FROM bancas b
       LEFT JOIN esquema_precios ep ON ep.id = b.esquema_precio_id
       LEFT JOIN esquema_pagos epg ON epg.id = b.esquema_pago_id
       ORDER BY b.nombre`
    );
    res.json({ bancas: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener bancas' });
  }
});

router.post('/bancas', async (req, res) => {
  const { nombre, codigo, nombre_ticket, esquema_precio_id, esquema_pago_id } = req.body;
  try {
    const result = await query(
      `INSERT INTO bancas (nombre, codigo, nombre_ticket, esquema_precio_id, esquema_pago_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre, codigo.toUpperCase(), nombre_ticket, esquema_precio_id, esquema_pago_id]
    );
    res.status(201).json({ banca: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear banca' });
  }
});

router.patch('/bancas/:id', async (req, res) => {
  const campos = req.body;
  const keys = Object.keys(campos).filter(k => k !== 'id');
  const values = keys.map(k => campos[k]);
  
  if (keys.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  try {
    await query(`UPDATE bancas SET ${setClause}, updated_at = now() WHERE id = $${keys.length + 1}`, [...values, req.params.id]);
    res.json({ estado: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar banca' });
  }
});

// =============================================
// 3. LOTERÍAS Y HORARIOS
// =============================================

router.get('/loterias', async (req, res) => {
  try {
    const result = await query(
      `SELECT l.*, lh.hora_inicio, lh.hora_cierre
       FROM loterias l
       LEFT JOIN loteria_horarios lh ON lh.loteria_id = l.id AND lh.dia_semana IS NULL
       ORDER BY l.orden, l.nombre`
    );
    res.json({ loterias: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener loterías' });
  }
});

router.put('/loterias/:id/horarios', async (req, res) => {
  const { dia_semana, hora_inicio, hora_cierre } = req.body;
  try {
    if (dia_semana === null || dia_semana === undefined) {
      await query(
        `INSERT INTO loteria_horarios (loteria_id, dia_semana, hora_inicio, hora_cierre)
         VALUES ($1, NULL, $2, $3)
         ON CONFLICT (loteria_id) WHERE dia_semana IS NULL
         DO UPDATE SET hora_inicio = $2, hora_cierre = $3`,
        [req.params.id, hora_inicio, hora_cierre]
      );
    } else {
      await query(
        `INSERT INTO loteria_horarios (loteria_id, dia_semana, hora_inicio, hora_cierre)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (loteria_id, dia_semana) WHERE dia_semana IS NOT NULL
         DO UPDATE SET hora_inicio = $3, hora_cierre = $4`,
        [req.params.id, dia_semana, hora_inicio, hora_cierre]
      );
    }
    res.json({ estado: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar horario' });
  }
});

// =============================================
// 4. ESQUEMAS DE PRECIOS Y PAGOS
// =============================================

// GET Esquemas de Precios
router.get('/esquemas/precios', async (req, res) => {
  try {
    const result = await query(
      `SELECT ep.*, 
       COALESCE(jsonb_agg(epd.*) FILTER (WHERE epd.id IS NOT NULL), '[]') as detalle
       FROM esquema_precios ep
       LEFT JOIN esquema_precios_detalle epd ON ep.id = epd.esquema_id
       GROUP BY ep.id ORDER BY ep.nombre`
    );
    res.json({ esquemas: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener esquemas' });
  }
});

// PUT Detalle de Precio (con soporte para lotería específica o general)
router.put('/esquemas/precios/:id/detalle', async (req, res) => {
  const { modalidad, precio, loteria_id } = req.body;
  try {
    const conflictClause = loteria_id 
      ? '(esquema_id, modalidad, loteria_id) WHERE loteria_id IS NOT NULL'
      : '(esquema_id, modalidad) WHERE loteria_id IS NULL';

    await query(
      `INSERT INTO esquema_precios_detalle (esquema_id, modalidad, precio, loteria_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ${conflictClause} DO UPDATE SET precio = EXCLUDED.precio`,
      [req.params.id, modalidad, precio, loteria_id || null]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar detalle de precio' });
  }
});

// =============================================
// 5. CONFIGURACIÓN GLOBAL DEL SISTEMA
// =============================================

router.get('/configuracion', async (req, res) => {
  try {
    const result = await query(`SELECT clave, valor FROM configuracion`);
    const config = result.rows.reduce((acc, row) => ({ ...acc, [row.clave]: row.valor }), {});
    res.json({ estado: 'ok', config });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener config' });
  }
});

router.put('/configuracion', async (req, res) => {
  try {
    for (const [clave, valor] of Object.entries(req.body)) {
      await query(
        `INSERT INTO configuracion (clave, valor) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor = $2, updated_at = now()`,
        [clave, String(valor)]
      );
    }
    res.json({ estado: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// Forzar generación de jornadas manualmente
router.post('/jornadas/generar', async (req, res) => {
  try {
    const result = await query('SELECT generar_jornadas()');
    res.json({ estado: 'ok', detalle: result.rows[0].generar_jornadas });
  } catch (err) {
    res.status(500).json({ error: 'Error al ejecutar generación de jornadas' });
  }
});


// GET Esquemas de Pagos
router.get('/esquemas/pagos', async (req, res) => {
  try {
    const result = await query(
      `SELECT ep.*, 
       COALESCE(jsonb_agg(epd.* ORDER BY epd.modalidad, epd.posicion) FILTER (WHERE epd.id IS NOT NULL), '[]') as detalle
       FROM esquema_pagos ep
       LEFT JOIN esquema_pagos_detalle epd ON ep.id = epd.esquema_id
       GROUP BY ep.id ORDER BY ep.nombre`
    );
    res.json({ esquemas: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener esquemas de pagos' });
  }
});

// POST Crear Esquema de Pago
router.post('/esquemas/pagos', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = await query(
      `INSERT INTO esquema_pagos (nombre) VALUES ($1) RETURNING *`,
      [nombre]
    );
    res.status(201).json({ esquema: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear esquema de pago' });
  }
});

// PATCH Renombrar Esquema de Pago
router.patch('/esquemas/pagos/:id', async (req, res) => {
  const { nombre } = req.body;
  try {
    await query(
      `UPDATE esquema_pagos SET nombre = $1, updated_at = now() WHERE id = $2`,
      [nombre, req.params.id]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Error al renombrar esquema de pago' });
  }
});

// PUT Detalle de Pago (multiplicador por modalidad y posición)
router.put('/esquemas/pagos/:id/detalle', async (req, res) => {
  const { modalidad, posicion, pago, loteria_id } = req.body;
  if (!modalidad || posicion === undefined || pago === undefined) {
    return res.status(400).json({ error: 'modalidad, posicion y pago son requeridos' });
  }
  try {
    const conflictClause = loteria_id
      ? '(esquema_id, modalidad, posicion, loteria_id) WHERE loteria_id IS NOT NULL'
      : '(esquema_id, modalidad, posicion) WHERE loteria_id IS NULL';

    await query(
      `INSERT INTO esquema_pagos_detalle (esquema_id, modalidad, posicion, pago, loteria_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ${conflictClause} DO UPDATE SET pago = EXCLUDED.pago`,
      [req.params.id, modalidad, posicion, pago, loteria_id || null]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error al guardar multiplicador:', err);
    res.status(500).json({ error: 'Error al guardar multiplicador' });
  }
});

module.exports = router;
