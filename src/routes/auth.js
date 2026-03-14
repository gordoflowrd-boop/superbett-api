const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password, banca_id } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    // 1. Buscar usuario
    const result = await query(
      `SELECT id, username, password, nombre, rol, activo FROM usuarios WHERE username = $1`,
      [username.trim().toLowerCase()]
    );

    const usuario = result.rows[0];

    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!usuario.activo) {
      return res.status(401).json({ error: 'Usuario desactivado' });
    }

    const passwordOk = await bcrypt.compare(password, usuario.password);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // 2. Admin y central: no necesitan banca_id
    if (['admin', 'central'].includes(usuario.rol)) {
      const payload = {
        id:       usuario.id,
        username: usuario.username,
        nombre:   usuario.nombre,
        rol:      usuario.rol,
        banca_id: null,
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      });
      return res.json({ token, usuario: payload });
    }

    // 3. Vendedor/rifero: banca_id es obligatorio
    if (!banca_id) {
      return res.status(400).json({ error: 'Configuración de banca no encontrada' });
    }

    // 4. Verificar que el usuario tiene acceso a esta banca
    const acceso = await query(
      `SELECT 1 FROM usuarios_bancas WHERE usuario_id = $1 AND banca_id = $2 LIMIT 1`,
      [usuario.id, banca_id]
    );
    if (!acceso.rows.length) {
      return res.status(403).json({ error: 'No tienes acceso a esta banca' });
    }

    // 5. Obtener nombre de la banca
    const bancaRes = await query(
      `SELECT nombre, nombre_ticket FROM bancas WHERE id = $1`,
      [banca_id]
    );
    const banca = bancaRes.rows[0];

    const payload = {
      id:       usuario.id,
      username: usuario.username,
      nombre:   usuario.nombre,
      rol:      usuario.rol,
      banca_id: banca_id,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    res.json({
      token,
      usuario: {
        ...payload,
        banca_nombre:        banca?.nombre        ?? '',
        banca_nombre_ticket: banca?.nombre_ticket ?? '',
      },
    });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;
