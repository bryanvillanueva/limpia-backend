const bcrypt = require('bcryptjs');
const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nombre, email, rol, activo, created_at FROM users ORDER BY nombre'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nombre, email, rol, activo, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ message: 'Campos requeridos: nombre, email, password, rol' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.query(
      'INSERT INTO users (nombre, email, password, rol) VALUES (?, ?, ?, ?)',
      [nombre, email, hash, rol]
    );
    res.status(201).json({ id: result.insertId, nombre, email, rol });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'El email ya está registrado' });
    }
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { nombre, email, rol, password } = req.body;
  try {
    let query, params;
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      query = 'UPDATE users SET nombre = ?, email = ?, rol = ?, password = ? WHERE id = ?';
      params = [nombre, email, rol, hash, req.params.id];
    } else {
      query = 'UPDATE users SET nombre = ?, email = ?, rol = ? WHERE id = ?';
      params = [nombre, email, rol, req.params.id];
    }
    const [result] = await db.query(query, params);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
    res.json({ message: 'Usuario actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE users SET activo = 0 WHERE id = ?',
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
    res.json({ message: 'Usuario desactivado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT uth.*, t.nombre AS equipo
       FROM user_team_history uth
       JOIN teams t ON uth.team_id = t.id
       WHERE uth.user_id = ?
       ORDER BY uth.fecha_inicio DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
