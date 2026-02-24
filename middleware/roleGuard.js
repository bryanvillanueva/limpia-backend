module.exports = function roleGuard(roles) {
  return function (req, res, next) {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ message: 'Acceso denegado' });
    }
    next();
  };
};
