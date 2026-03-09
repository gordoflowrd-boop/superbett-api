const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();

// Middleware de autenticación y autorización actualizado
router.use(authMiddleware);
router.use(requireRol('admin', 'central'));

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
  const { nombre, username, rol, activo, password, password_actual } = req.body;
  const { id } = req.params;
  const esPropio = String(req.usuario.id) === String(id); // Admin editando su propia cuenta

  try {
    // ── Cambio de contraseña ────────────────────────────
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      }

      // Si es su propia cuenta, verificar contraseña actual
      if (esPropio) {
        if (!password_actual) {
          return res.status(400).json({ error: 'Debes ingresar tu contraseña actual' });
        }
        const userRes = await query('SELECT password FROM usuarios WHERE id = $1', [id]);
        const ok = await bcrypt.compare(password_actual, userRes.rows[0].password);
        if (!ok) {
          return res.status(401).json({ error: 'Contraseña actual incorrecta' });
        }
      }

      const hash = await bcrypt.hash(password, 10);
      await query('UPDATE usuarios SET password = $1, updated_at = now() WHERE id = $2', [hash, id]);
    }

    // ── Verificar username único ────────────────────────
    if (username !== undefined) {
      const existe = await query(
        'SELECT id FROM usuarios WHERE username = $1 AND id != $2',
        [username.trim().toLowerCase(), id]
      );
      if (existe.rows.length > 0) {
        return res.status(409).json({ error: 'El username ya está en uso' });
      }
    }

    // ── Actualizar datos ────────────────────────────────
    if (nombre !== undefined || username !== undefined || rol !== undefined || activo !== undefined) {
      // Usar valores directos: si viene definido se usa, si no se usa COALESCE para mantener el actual
      const nombreVal   = nombre   !== undefined ? (nombre.trim()   || null)                    : null;
      const usernameVal = username !== undefined ? (username.trim().toLowerCase() || null)       : null;
      const rolVal      = rol      !== undefined ? (rol              || null)                    : null;
      const activoVal   = activo   !== undefined ? activo                                        : null;

      await query(
        `UPDATE usuarios SET
           nombre     = CASE WHEN $1::text IS NOT NULL THEN $1::text ELSE nombre     END,
           username   = CASE WHEN $2::text IS NOT NULL THEN $2::text ELSE username   END,
           rol        = CASE WHEN $3::text IS NOT NULL THEN $3::text ELSE rol        END,
           activo     = CASE WHEN $4::bool IS NOT NULL THEN $4::bool ELSE activo     END,
           updated_at = now()
         WHERE id = $5`,
        [nombreVal, usernameVal, rolVal, activoVal, id]
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
          limite_q, limite_p, limite_t, limite_sp, activa,
          comision_q, comision_p, comision_t, comision_sp,
          tope_q, tope_p, tope_t, tope_sp } = req.body;
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
         comision_q        = COALESCE($10, comision_q),
         comision_p        = COALESCE($11, comision_p),
         comision_t        = COALESCE($12, comision_t),
         comision_sp       = COALESCE($13, comision_sp),
         tope_q            = COALESCE($14, tope_q),
         tope_p            = COALESCE($15, tope_p),
         tope_t            = COALESCE($16, tope_t),
         tope_sp           = COALESCE($17, tope_sp),
         updated_at        = now()
       WHERE id = $18`,
      [nombre, nombre_ticket, esquema_precio_id, esquema_pago_id,
       limite_q, limite_p, limite_t, limite_sp, activa,
       comision_q, comision_p, comision_t, comision_sp,
       tope_q, tope_p, tope_t, tope_sp, req.params.id]
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
      `SELECT l.*,
              lh.hora_inicio,
              lh.hora_cierre
       FROM loterias l
       LEFT JOIN loteria_horarios lh
         ON lh.loteria_id = l.id
         AND lh.dia_semana IS NULL   -- solo el horario defecto
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

    // Siempre insertar horario defecto (NULL = aplica todos los días)
    await query(
      `INSERT INTO loteria_horarios (loteria_id, hora_inicio, hora_cierre, dia_semana)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT DO NOTHING`,
      [loteria_id,
       hora_inicio || '07:30',
       hora_cierre || '23:59']
    );

    res.status(201).json({ estado: 'ok', id: loteria_id });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El código de lotería ya existe' });
    }
    console.error('Error crear lotería:', err);
    res.status(500).json({ error: 'Error al crear lotería' });
  }
});

// PATCH /api/admin/loterias/:id — actualizar límites generales por número
router.patch('/loterias/:id', async (req, res) => {
  const { limite_q, limite_p, limite_t, limite_sp } = req.body;
  try {
    await query(
      `UPDATE loterias
          SET limite_q  = $1,
              limite_p  = $2,
              limite_t  = $3,
              limite_sp = $4
        WHERE id = $5`,
      [
        limite_q  ?? null,
        limite_p  ?? null,
        limite_t  ?? null,
        limite_sp ?? null,
        req.params.id,
      ]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error patch loterias:', err);
    res.status(500).json({ error: 'Error al actualizar límites' });
  }
});

// GET /api/admin/loterias/:id/horarios — todos los horarios de una lotería
router.get('/loterias/:id/horarios', async (req, res) => {
  try {
    const r = await query(
      `SELECT id, dia_semana, hora_inicio, hora_cierre
       FROM loteria_horarios
       WHERE loteria_id = $1
       ORDER BY dia_semana NULLS FIRST`,
      [req.params.id]
    );
    res.json({ horarios: r.rows });
  } catch (err) {
    console.error('Error get horarios:', err);
    res.status(500).json({ error: 'Error al obtener horarios' });
  }
});

// PUT /api/admin/loterias/:id/horarios — upsert horario de un día
// body: { dia_semana: null|0-6, hora_inicio, hora_cierre }
router.put('/loterias/:id/horarios', async (req, res) => {
  const { dia_semana, hora_inicio, hora_cierre } = req.body;
  if (!hora_inicio || !hora_cierre) {
    return res.status(400).json({ error: 'hora_inicio y hora_cierre requeridos' });
  }
  try {
    if (dia_semana === null || dia_semana === undefined) {
      // Defecto — usa índice parcial WHERE dia_semana IS NULL
      await query(
        `INSERT INTO loteria_horarios (loteria_id, dia_semana, hora_inicio, hora_cierre)
         VALUES ($1, NULL, $2, $3)
         ON CONFLICT (loteria_id) WHERE dia_semana IS NULL
         DO UPDATE SET hora_inicio = $2, hora_cierre = $3`,
        [req.params.id, hora_inicio, hora_cierre]
      );
    } else {
      // Día específico — usa índice parcial WHERE dia_semana IS NOT NULL
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
    console.error('Error upsert horario:', err);
    res.status(500).json({ error: 'Error al guardar horario' });
  }
});

// PATCH /api/admin/loterias/:id/zona — actualizar zona horaria
router.patch('/loterias/:id/zona', async (req, res) => {
  const { zona_horaria } = req.body;
  if (!zona_horaria) return res.status(400).json({ error: 'zona_horaria requerida' });
  try {
    await query(
      `UPDATE loterias SET zona_horaria = $1 WHERE id = $2`,
      [zona_horaria, req.params.id]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error patch zona:', err);
    res.status(500).json({ error: 'Error al actualizar zona' });
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


// =============================================
// ESQUEMAS — ESCRITURA
// =============================================

// POST /api/admin/esquemas/precios — crear nuevo esquema de precios
router.post('/esquemas/precios', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  try {
    const r = await query(
      `INSERT INTO esquema_precios (nombre) VALUES ($1) RETURNING id, nombre, activo`,
      [nombre.trim()]
    );
    res.status(201).json({ esquema: r.rows[0] });
  } catch (err) {
    console.error('Error crear esquema precios:', err);
    res.status(500).json({ error: 'Error al crear esquema' });
  }
});

// PUT /api/admin/esquemas/precios/:id/detalle — upsert línea de precio
router.put('/esquemas/precios/:id/detalle', async (req, res) => {
  const { modalidad, precio, loteria_id } = req.body;
  if (!modalidad || precio === undefined) {
    return res.status(400).json({ error: 'modalidad y precio son requeridos' });
  }
  try {
    if (loteria_id) {
      // Caso específico por lotería — usa índice con loteria_id
      await query(
        `INSERT INTO esquema_precios_detalle (esquema_id, modalidad, precio, loteria_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (esquema_id, modalidad, loteria_id) WHERE loteria_id IS NOT NULL
         DO UPDATE SET precio = EXCLUDED.precio`,
        [req.params.id, modalidad, precio, loteria_id]
      );
    } else {
      // Caso general sin lotería — usa índice parcial WHERE loteria_id IS NULL
      await query(
        `INSERT INTO esquema_precios_detalle (esquema_id, modalidad, precio, loteria_id)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (esquema_id, modalidad) WHERE loteria_id IS NULL
         DO UPDATE SET precio = EXCLUDED.precio`,
        [req.params.id, modalidad, precio]
      );
    }
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error upsert precio:', err);
    res.status(500).json({ error: 'Error al guardar precio' });
  }
});

// PATCH /api/admin/esquemas/precios/:id — renombrar o activar/desactivar
router.patch('/esquemas/precios/:id', async (req, res) => {
  const { nombre, activo } = req.body;
  try {
    await query(
      `UPDATE esquema_precios SET
         nombre = COALESCE($1, nombre),
         activo = COALESCE($2, activo)
       WHERE id = $3`,
      [nombre || null, activo ?? null, req.params.id]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error patch esquema precios:', err);
    res.status(500).json({ error: 'Error al actualizar esquema' });
  }
});

// POST /api/admin/esquemas/pagos — crear nuevo esquema de pagos
router.post('/esquemas/pagos', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  try {
    const r = await query(
      `INSERT INTO esquema_pagos (nombre) VALUES ($1) RETURNING id, nombre, activo`,
      [nombre.trim()]
    );
    res.status(201).json({ esquema: r.rows[0] });
  } catch (err) {
    console.error('Error crear esquema pagos:', err);
    res.status(500).json({ error: 'Error al crear esquema' });
  }
});

// PUT /api/admin/esquemas/pagos/:id/detalle — upsert multiplicador
router.put('/esquemas/pagos/:id/detalle', async (req, res) => {
  const { modalidad, posicion, pago, loteria_id } = req.body;
  if (!modalidad || posicion === undefined || pago === undefined) {
    return res.status(400).json({ error: 'modalidad, posicion y pago son requeridos' });
  }
  try {
    if (loteria_id) {
      // Caso específico por lotería
      await query(
        `INSERT INTO esquema_pagos_detalle (esquema_id, modalidad, posicion, pago, loteria_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (esquema_id, modalidad, posicion, loteria_id) WHERE loteria_id IS NOT NULL
         DO UPDATE SET pago = EXCLUDED.pago`,
        [req.params.id, modalidad, posicion, pago, loteria_id]
      );
    } else {
      // Caso general sin lotería
      await query(
        `INSERT INTO esquema_pagos_detalle (esquema_id, modalidad, posicion, pago, loteria_id)
         VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT (esquema_id, modalidad, posicion) WHERE loteria_id IS NULL
         DO UPDATE SET pago = EXCLUDED.pago`,
        [req.params.id, modalidad, posicion, pago]
      );
    }
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error upsert pago:', err);
    res.status(500).json({ error: 'Error al guardar multiplicador' });
  }
});

// PATCH /api/admin/esquemas/pagos/:id — renombrar o activar/desactivar
router.patch('/esquemas/pagos/:id', async (req, res) => {
  const { nombre, activo } = req.body;
  try {
    await query(
      `UPDATE esquema_pagos SET
         nombre = COALESCE($1, nombre),
         activo = COALESCE($2, activo)
       WHERE id = $3`,
      [nombre || null, activo ?? null, req.params.id]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error patch esquema pagos:', err);
    res.status(500).json({ error: 'Error al actualizar esquema' });
  }
});

// =============================================
// CONFIGURACIÓN GLOBAL
// =============================================

// GET /api/admin/configuracion
router.get('/configuracion', async (req, res) => {
  try {
    const result = await query(`SELECT clave, valor FROM configuracion`);
    const config = {};
    for (const row of result.rows) {
      config[row.clave] = row.valor;
    }
    // Valores por defecto si no existen en BD
    if (config.tiempo_anulacion === undefined) config.tiempo_anulacion = '0';
    if (config.hora_jornada     === undefined) config.hora_jornada     = '2';
    res.json({ estado: 'ok', config });
  } catch (err) {
    console.error('CONFIG ERROR:', err);
    res.status(500).json({ estado: 'error', error: err.message });
  }
});

// PUT /api/admin/configuracion — acepta cualquier clave del body
router.put('/configuracion', async (req, res) => {
  const claves = ['tiempo_anulacion', 'hora_jornada'];
  try {
    for (const clave of claves) {
      if (req.body[clave] !== undefined) {
        await query(
          `INSERT INTO configuracion (clave, valor, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (clave) DO UPDATE
               SET valor = $2, updated_at = now()`,
          [clave, String(req.body[clave])]
        );
      }
    }
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error guardar configuracion:', err);
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// POST /api/admin/jornadas/generar — forzar generación manual de jornadas
router.post('/jornadas/generar', async (req, res) => {
  try {
    const result = await query('SELECT generar_jornadas()');
    const data = result.rows[0].generar_jornadas;
    res.json({ estado: 'ok', data });
  } catch (err) {
    console.error('Error generar jornadas:', err);
    res.status(500).json({ error: 'Error al generar jornadas' });
  }
});

module.exports = router;