const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password, banca_id } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    const result = await query(
      `SELECT id, username, password, nombre, rol, activo FROM usuarios WHERE username = $1`,
      [username.trim().toLowerCase()]
    );

    const usuario = result.rows[0];
    if (!usuario) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (!usuario.activo) return res.status(401).json({ error: 'Usuario desactivado' });

    const passwordOk = await bcrypt.compare(password, usuario.password);
    if (!passwordOk) return res.status(401).json({ error: 'Credenciales inválidas' });

    // ── Admin, central, rifero y técnico: sin banca ─
    if (['admin', 'central', 'tecnico', 'rifero'].includes(usuario.rol)) {
      // Obtener páginas según rol
      let paginas = [];

      if (usuario.rol === 'admin') {
        // Admin ve todo — no necesita tabla
        paginas = ['dashboard','bancas','venta','premios','reportes',
                   'riferos','usuarios','mensajes','limites','configuracion',
                   'contabilidad','descargas'];
      } else if (usuario.rol === 'tecnico') {
        // Técnico — fijo, solo estas 3
        paginas = ['dashboard','bancas','descargas'];
      } else {
        // Central y rifero — leer de permisos_paginas, con defaults
        const permRes = await query(
          `SELECT pagina FROM permisos_paginas WHERE usuario_id = $1`,
          [usuario.id]
        );
        if (permRes.rows.length > 0) {
          paginas = permRes.rows.map(r => r.pagina);
        } else {
          // Defaults si no tiene permisos configurados
          if (usuario.rol === 'central') {
            paginas = ['dashboard','bancas','venta','premios','reportes',
                       'usuarios','mensajes','limites','configuracion','descargas'];
          } else if (usuario.rol === 'rifero') {
            paginas = ['dashboard','bancas','premios','reportes','mensajes','descargas'];
          }
        }
        // Dashboard y descargas siempre visibles
        if (!paginas.includes('dashboard')) paginas.unshift('dashboard');
        if (!paginas.includes('descargas')) paginas.push('descargas');
      }

      const payload = {
        id: usuario.id, username: usuario.username,
        nombre: usuario.nombre, rol: usuario.rol,
        banca_id: null, paginas,
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
      return res.json({ token, usuario: payload });
    }

    // ── Vendedor: necesita banca_id ─────────────────
    if (!banca_id) {
      return res.status(400).json({ error: 'Configuración de banca no encontrada' });
    }

    // Obtener banca con su rifero
    const bancaRes = await query(
      `SELECT id, nombre, nombre_ticket, rifero_id FROM bancas WHERE id = $1 AND activa = true`,
      [banca_id]
    );
    if (!bancaRes.rows.length) {
      return res.status(403).json({ error: 'Banca no encontrada o inactiva' });
    }
    const banca = bancaRes.rows[0];

    if (!banca.rifero_id) {
      return res.status(403).json({ error: 'Esta banca no tiene rifero asignado' });
    }

    // Verificar que el vendedor pertenece al rifero de esta banca
    const acceso = await query(
      `SELECT 1 FROM usuarios_riferos
       WHERE usuario_id = $1 AND rifero_id = $2 LIMIT 1`,
      [usuario.id, banca.rifero_id]
    );
    if (!acceso.rows.length) {
      return res.status(403).json({ error: 'No tienes acceso a esta banca' });
    }

    const payload = {
      id: usuario.id, username: usuario.username,
      nombre: usuario.nombre, rol: usuario.rol, banca_id,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

    res.json({
      token,
      usuario: {
        ...payload,
        banca_nombre:        banca.nombre        ?? '',
        banca_nombre_ticket: banca.nombre_ticket ?? '',
      },
    });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;
