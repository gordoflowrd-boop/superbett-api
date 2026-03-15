const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();

// Middleware de seguridad: admin, central y técnico
router.use(authMiddleware);
router.use(requireRol('admin', 'central', 'tecnico'));

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

// GET /api/admin/usuarios/:id/riferos — riferos asignados a un vendedor
router.get('/usuarios/:id/riferos', async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.nombre
       FROM usuarios_riferos ur
       JOIN usuarios u ON u.id = ur.rifero_id
       WHERE ur.usuario_id = $1 ORDER BY u.username`,
      [req.params.id]
    );
    res.json({ riferos: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener riferos del vendedor' });
  }
});

// POST /api/admin/usuarios/:id/riferos — asignar vendedor a rifero
router.post('/usuarios/:id/riferos', async (req, res) => {
  const { rifero_id } = req.body;
  if (!rifero_id) return res.status(400).json({ error: 'rifero_id requerido' });
  try {
    await query(
      `INSERT INTO usuarios_riferos (usuario_id, rifero_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, rifero_id]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Error al asignar rifero' });
  }
});

// DELETE /api/admin/usuarios/:id/riferos/:rifero_id — quitar rifero de vendedor
router.delete('/usuarios/:id/riferos/:rifero_id', async (req, res) => {
  try {
    await query(
      `DELETE FROM usuarios_riferos WHERE usuario_id = $1 AND rifero_id = $2`,
      [req.params.id, req.params.rifero_id]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Error al quitar rifero' });
  }
});

// =============================================
// 2. GESTIÓN DE BANCAS
// =============================================

router.get('/bancas', async (req, res) => {
  try {
    const result = await query(
      `SELECT b.*, ep.nombre AS esquema_precio, epg.nombre AS esquema_pago,
              u.id AS rifero_id, u.username AS rifero_username, u.nombre AS rifero_nombre
       FROM bancas b
       LEFT JOIN esquema_precios ep  ON ep.id  = b.esquema_precio_id
       LEFT JOIN esquema_pagos   epg ON epg.id = b.esquema_pago_id
       LEFT JOIN usuarios        u   ON u.id   = b.rifero_id
       ORDER BY b.nombre`
    );
    res.json({ bancas: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener bancas' });
  }
});

// GET /api/admin/riferos/:id/vendedores — vendedores asignados a un rifero
router.get('/riferos/:id/vendedores', async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.nombre, u.activo
       FROM usuarios_riferos ur
       JOIN usuarios u ON u.id = ur.usuario_id
       WHERE ur.rifero_id = $1
       ORDER BY u.username`,
      [req.params.id]
    );
    res.json({ vendedores: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener vendedores del rifero' });
  }
});

// GET /api/admin/riferos — lista usuarios con rol rifero para selector
router.get('/riferos', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, nombre FROM usuarios
       WHERE rol = 'rifero' AND activo = true ORDER BY username`
    );
    res.json({ riferos: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener riferos' });
  }
});

// PUT /api/admin/bancas/:id/rifero — asignar rifero por defecto
router.put('/bancas/:id/rifero', async (req, res) => {
  const { rifero_id } = req.body;
  try {
    await query(
      `UPDATE bancas SET rifero_id = $1, updated_at = now() WHERE id = $2`,
      [rifero_id || null, req.params.id]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// PUT /api/admin/bancas/:id/ip — configurar IP permitida
router.put('/bancas/:id/ip', async (req, res) => {
  const { ip_config } = req.body;
  try {
    await query(
      `UPDATE bancas SET ip_config = $1, updated_at = now() WHERE id = $2`,
      [ip_config?.trim() || null, req.params.id]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error actualizar ip_config:', err);
    res.status(500).json({ error: err.message });
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

// PATCH actualizar límites de una lotería
router.patch('/loterias/:id', async (req, res) => {
  const { limite_q, limite_p, limite_t, limite_sp } = req.body;
  try {
    await query(
      `UPDATE loterias SET
         limite_q  = $1,
         limite_p  = $2,
         limite_t  = $3,
         limite_sp = $4
       WHERE id = $5`,
      [
        limite_q  ?? null,
        limite_p  ?? null,
        limite_t  ?? null,
        limite_sp ?? null,
        req.params.id
      ]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error al guardar límites:', err);
    res.status(500).json({ error: err.message || 'Error al guardar límites' });
  }
});

router.get('/loterias/:id/horarios', async (req, res) => {
  try {
    const result = await query(
      `SELECT dia_semana, hora_inicio, hora_cierre
       FROM loteria_horarios
       WHERE loteria_id = $1 AND dia_semana IS NOT NULL
       ORDER BY dia_semana`,
      [req.params.id]
    );
    res.json({ horarios: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener horarios' });
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
    if (loteria_id) {
      await query(
        `INSERT INTO esquema_pagos_detalle (esquema_id, modalidad, posicion, pago, loteria_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (esquema_id, loteria_id, modalidad, posicion) WHERE loteria_id IS NOT NULL
         DO UPDATE SET pago = EXCLUDED.pago`,
        [req.params.id, modalidad, posicion, pago, loteria_id]
      );
    } else {
      // Para loteria_id NULL usamos UPDATE + INSERT manual porque ON CONFLICT no funciona con NULLs
      const existing = await query(
        `SELECT id FROM esquema_pagos_detalle WHERE esquema_id = $1 AND modalidad = $2 AND posicion = $3 AND loteria_id IS NULL`,
        [req.params.id, modalidad, posicion]
      );
      if (existing.rows.length > 0) {
        await query(
          `UPDATE esquema_pagos_detalle SET pago = $1 WHERE id = $2`,
          [pago, existing.rows[0].id]
        );
      } else {
        await query(
          `INSERT INTO esquema_pagos_detalle (esquema_id, modalidad, posicion, pago, loteria_id)
           VALUES ($1, $2, $3, $4, NULL)`,
          [req.params.id, modalidad, posicion, pago]
        );
      }
    }
    res.json({ estado: 'ok' });
  } catch (err) {
    console.error('Error al guardar multiplicador:', err);
    res.status(500).json({ error: 'Error al guardar multiplicador' });
  }
});

// =============================================
// DESCARGAS
// =============================================

// GET /api/admin/descargas — todos los roles
router.get('/descargas', async (req, res) => {
  try {
    const result = await query(`SELECT * FROM descargas ORDER BY clave`);
    res.json({ descargas: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/descargas/:clave — solo admin actualiza
router.put('/descargas/:clave', async (req, res) => {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo el admin puede actualizar descargas' });
  }
  const { url, version, notas } = req.body;
  try {
    await query(
      `INSERT INTO descargas (clave, url, version, notas, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (clave) DO UPDATE
         SET url = $2, version = $3, notas = $4, updated_at = now()`,
      [req.params.clave, url, version, notas]
    );
    res.json({ estado: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
