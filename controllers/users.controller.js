const bcrypt = require('bcryptjs');
const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nombre, apellido, email, telefono, direccion, tipo_visa, fecha_vencimiento_visa, rol, activo FROM users ORDER BY nombre'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nombre, apellido, email, telefono, direccion, tipo_visa, fecha_vencimiento_visa, rol, activo FROM users WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { nombre, apellido, email, password, telefono, direccion, tipo_visa, fecha_vencimiento_visa, rol } = req.body;
  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ message: 'Campos requeridos: nombre, email, password, rol' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.query(
      'INSERT INTO users (nombre, apellido, email, password_hash, telefono, direccion, tipo_visa, fecha_vencimiento_visa, rol) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [nombre, apellido, email, hash, telefono, direccion, tipo_visa, fecha_vencimiento_visa, rol]
    );
    res.status(201).json({ id: result.insertId, nombre, apellido, email, rol });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'El email ya está registrado' });
    }
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { nombre, apellido, email, password, telefono, direccion, tipo_visa, fecha_vencimiento_visa, rol } = req.body;
  try {
    let query, params;
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      query = 'UPDATE users SET nombre = ?, apellido = ?, email = ?, password_hash = ?, telefono = ?, direccion = ?, tipo_visa = ?, fecha_vencimiento_visa = ?, rol = ? WHERE id = ?';
      params = [nombre, apellido, email, hash, telefono, direccion, tipo_visa, fecha_vencimiento_visa, rol, req.params.id];
    } else {
      query = 'UPDATE users SET nombre = ?, apellido = ?, email = ?, telefono = ?, direccion = ?, tipo_visa = ?, fecha_vencimiento_visa = ?, rol = ? WHERE id = ?';
      params = [nombre, apellido, email, telefono, direccion, tipo_visa, fecha_vencimiento_visa, rol, req.params.id];
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
      `SELECT uth.*, t.numero AS equipo_numero
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
