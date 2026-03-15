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

    // ── Admin, central y técnico: sin banca ────────
    if (['admin', 'central', 'tecnico'].includes(usuario.rol)) {
      const payload = {
        id: usuario.id, username: usuario.username,
        nombre: usuario.nombre, rol: usuario.rol, banca_id: null,
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
      return res.json({ token, usuario: payload });
    }

    // ── Rifero: entra al panel admin, no al POS ─────
    if (usuario.rol === 'rifero') {
      return res.status(403).json({ error: 'Los riferos acceden al panel admin' });
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
