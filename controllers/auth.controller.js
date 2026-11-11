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

/** Columns of the profile the user can see about themselves (never the password hash). */
const PROFILE_SQL = `SELECT id, nombre, apellido, email, telefono, direccion, tipo_visa,
        DATE_FORMAT(fecha_vencimiento_visa, '%Y-%m-%d') AS fecha_vencimiento_visa, rol
 FROM users WHERE id = ? AND activo = 1`;

async function loadProfile(userId) {
  const [rows] = await db.query(PROFILE_SQL, [userId]);
  return rows[0] || null;
}

/** GET /api/auth/me — the authenticated user's own profile. */
exports.getMe = async (req, res) => {
  try {
    const profile = await loadProfile(req.user.id);
    if (!profile) return res.status(404).json({ message: 'Usuario no encontrado' });
    return res.json(profile);
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/** Trims and collapses inner whitespace; non-strings become ''. */
const clean = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/**
 * PUT /api/auth/me — the user updates their own basic data.
 * Editable: nombre, apellido, telefono, direccion, tipo_visa, fecha_vencimiento_visa.
 * Email and role are NOT editable here (email is the login; both are managed by an admin).
 * Optional fields sent empty are stored as NULL.
 */
exports.updateMe = async (req, res) => {
  const nombre = clean(req.body.nombre);
  const apellido = clean(req.body.apellido);
  const telefono = clean(req.body.telefono);
  const direccion = clean(req.body.direccion);
  const tipoVisa = clean(req.body.tipo_visa);
  const fechaVisa = clean(req.body.fecha_vencimiento_visa);

  if (!nombre) return res.status(400).json({ message: 'El nombre es obligatorio' });
  if (nombre.length > 100) return res.status(400).json({ message: 'El nombre no puede superar 100 caracteres' });
  if (apellido.length > 100) return res.status(400).json({ message: 'El apellido no puede superar 100 caracteres' });
  if (telefono.length > 20 || !/^[0-9+()\-\s]*$/.test(telefono)) {
    return res.status(400).json({ message: 'El teléfono solo puede tener números, espacios, +, - y paréntesis (máx. 20 caracteres)' });
  }
  if (direccion.length > 255) return res.status(400).json({ message: 'La dirección no puede superar 255 caracteres' });
  if (tipoVisa.length > 50) return res.status(400).json({ message: 'El tipo de visa no puede superar 50 caracteres' });
  if (fechaVisa) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(fechaVisa) && !Number.isNaN(new Date(`${fechaVisa}T00:00:00Z`).getTime())
      && new Date(`${fechaVisa}T00:00:00Z`).toISOString().slice(0, 10) === fechaVisa;
    if (!valid) return res.status(400).json({ message: 'La fecha de vencimiento de la visa no es válida' });
  }

  try {
    const [result] = await db.query(
      `UPDATE users
       SET nombre = ?, apellido = ?, telefono = ?, direccion = ?, tipo_visa = ?, fecha_vencimiento_visa = ?
       WHERE id = ? AND activo = 1`,
      [nombre, apellido || null, telefono || null, direccion || null, tipoVisa || null, fechaVisa || null, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
    return res.json(await loadProfile(req.user.id));
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

// Wrong "current password" attempts per user: a stolen session token must not be able to guess the password.
const PASSWORD_MAX_FAILS = 5;
const PASSWORD_LOCK_MS = 15 * 60 * 1000;
const passwordFails = new Map(); // userId -> { count, since }

function passwordLocked(userId) {
  const entry = passwordFails.get(userId);
  if (!entry) return false;
  if (Date.now() - entry.since > PASSWORD_LOCK_MS) { passwordFails.delete(userId); return false; }
  return entry.count >= PASSWORD_MAX_FAILS;
}

function registerPasswordFail(userId) {
  const entry = passwordFails.get(userId);
  if (!entry || Date.now() - entry.since > PASSWORD_LOCK_MS) passwordFails.set(userId, { count: 1, since: Date.now() });
  else entry.count += 1;
}

const LOCKED_MESSAGE = 'Demasiados intentos con una contraseña incorrecta. Inténtalo de nuevo en 15 minutos.';

/**
 * PUT /api/auth/password — the user changes their own password.
 * Body: { current_password, new_password }. The current one must be correct, the new one must have
 * 8-72 characters (bcrypt ignores anything past 72) and be different from the current one.
 * A wrong current password answers 400 (not 401: the client logs out on every 401).
 */
exports.changePassword = async (req, res) => {
  const current = req.body.current_password;
  const next = req.body.new_password;

  if (typeof current !== 'string' || !current || typeof next !== 'string' || !next) {
    return res.status(400).json({ message: 'Ingresa tu contraseña actual y la nueva' });
  }
  if (next.length < 8) return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 8 caracteres' });
  if (next.length > 72) return res.status(400).json({ message: 'La nueva contraseña no puede superar 72 caracteres' });
  if (next === current) return res.status(400).json({ message: 'La nueva contraseña debe ser distinta de la actual' });
  if (passwordLocked(req.user.id)) return res.status(429).json({ message: LOCKED_MESSAGE });

  try {
    const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ? AND activo = 1', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado' });

    const ok = await bcrypt.compare(current, rows[0].password_hash || '');
    if (!ok) {
      registerPasswordFail(req.user.id);
      return passwordLocked(req.user.id)
        ? res.status(429).json({ message: LOCKED_MESSAGE })
        : res.status(400).json({ message: 'La contraseña actual no es correcta' });
    }

    const hash = await bcrypt.hash(next, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    passwordFails.delete(req.user.id);
    return res.json({ message: 'Contraseña actualizada' });
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
