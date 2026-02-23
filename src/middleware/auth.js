const jwt = require('jsonwebtoken');

/**
 * Verifica el JWT en el header Authorization.
 * Agrega req.usuario con { id, username, rol, banca_id } al request.
 */
const authMiddleware = (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

/**
 * Restringe acceso a roles específicos.
 * Uso: requireRol('admin') o requireRol('admin', 'central')
 */
const requireRol = (...roles) => (req, res, next) => {
  if (!roles.includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'Acceso no autorizado' });
  }
  next();
};

module.exports = { authMiddleware, requireRol };
