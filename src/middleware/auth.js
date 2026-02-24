const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticación.
 * Verifica JWT y agrega req.usuario al request.
 */
const authMiddleware = (req, res, next) => {

  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = header.split(' ')[1];

  try {

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Validación mínima del payload
    if (!payload.id || !payload.rol) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    req.usuario = {
      id: payload.id,
      username: payload.username,
      nombre: payload.nombre,
      rol: payload.rol,
      banca_id: payload.banca_id || null
    };

    next();

  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};


/**
 * Middleware para restringir acceso por rol.
 * Uso: requireRol('admin') o requireRol('admin', 'vendedor')
 */
const requireRol = (...rolesPermitidos) => {

  return (req, res, next) => {

    if (!req.usuario || !req.usuario.rol) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const rolUsuario = String(req.usuario.rol).toLowerCase();
    const roles = rolesPermitidos.map(r => String(r).toLowerCase());

    if (!roles.includes(rolUsuario)) {
      return res.status(403).json({ error: 'Acceso no autorizado' });
    }

    next();
  };
};


module.exports = {
  authMiddleware,
  requireRol
};