const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    const result = await query(
      `SELECT u.id, u.username, u.password, u.nombre, u.rol, u.activo,
              ub.banca_id
       FROM usuarios u
       LEFT JOIN (
         SELECT DISTINCT ON (usuario_id) usuario_id, banca_id
         FROM usuarios_bancas ORDER BY usuario_id
       ) ub ON ub.usuario_id = u.id
       WHERE u.username = $1`,
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

    const payload = {
      id:       usuario.id,
      username: usuario.username,
      nombre:   usuario.nombre,
      rol:      usuario.rol,
      banca_id: usuario.banca_id || null,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    res.json({
      token,
      usuario: payload,
    });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/auth/me — info del usuario autenticado
router.get('/me', authMiddleware, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;
