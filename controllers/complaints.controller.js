const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, u.nombre AS reportado_por
       FROM complaints c
       JOIN users u ON c.user_id = u.id
       ORDER BY c.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, u.nombre AS reportado_por
       FROM complaints c
       JOIN users u ON c.user_id = u.id
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
  const { descripcion, tipo, site_id } = req.body;
  if (!descripcion) return res.status(400).json({ message: 'Descripción requerida' });
  try {
    const [result] = await db.query(
      'INSERT INTO complaints (user_id, descripcion, tipo, site_id, estado) VALUES (?, ?, ?, ?, "abierto")',
      [req.user.id, descripcion, tipo, site_id || null]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { descripcion, estado, resolucion } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE complaints SET descripcion = ?, estado = ?, resolucion = ? WHERE id = ?',
      [descripcion, estado, resolucion, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Queja no encontrada' });
    res.json({ message: 'Queja actualizada' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
