const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, u.nombre AS reportado_por_nombre
       FROM complaints c
       LEFT JOIN users u ON c.reportado_por = u.id
       ORDER BY c.id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, u.nombre AS reportado_por_nombre
       FROM complaints c
       LEFT JOIN users u ON c.reportado_por = u.id
       WHERE c.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Queja no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { descripcion, categoria, severidad, site_id } = req.body;
  if (!descripcion) return res.status(400).json({ message: 'Descripción requerida' });
  try {
    const [result] = await db.query(
      'INSERT INTO complaints (site_id, descripcion, reportado_por, categoria, severidad, estado) VALUES (?, ?, ?, ?, ?, "abierto")',
      [site_id || null, descripcion, req.user.id, categoria, severidad]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { descripcion, categoria, severidad, estado, asignado_team_id, asignado_user_id } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE complaints SET descripcion = ?, categoria = ?, severidad = ?, estado = ?, asignado_team_id = ?, asignado_user_id = ? WHERE id = ?',
      [descripcion, categoria, severidad, estado, asignado_team_id, asignado_user_id, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Queja no encontrada' });
    res.json({ message: 'Queja actualizada' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
