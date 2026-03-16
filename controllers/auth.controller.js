const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email y contraseña requeridos' });
  }

  try {
    const [rows] = await db.query(
      'SELECT id, nombre, email, password_hash, rol FROM users WHERE email = ? AND activo = 1',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    let equipo_id = null;
    if (user.rol === 'cleaner') {
      const [teamRows] = await db.query(
        'SELECT team_id FROM user_team_history WHERE user_id = ? AND fecha_fin IS NULL',
        [user.id]
      );
      if (teamRows.length > 0) {
        equipo_id = teamRows[0].team_id;
      }
    }

    const token = jwt.sign(
      { id: user.id, nombre: user.nombre, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({ token, user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, equipo_id } });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.logout = (req, res) => {
  // JWT is stateless; client must drop the token
  res.json({ message: 'Sesión cerrada' });
};
