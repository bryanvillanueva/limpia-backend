const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token requerido' });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id, rol: decoded.rol, nombre: decoded.nombre };
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido o expirado' });
  }
};
