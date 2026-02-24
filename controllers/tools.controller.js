const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tools ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tools WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Herramienta no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { nombre, descripcion, estado } = req.body;
  if (!nombre) return res.status(400).json({ message: 'Nombre requerido' });
  try {
    const [result] = await db.query(
      'INSERT INTO tools (nombre, descripcion, estado) VALUES (?, ?, ?)',
      [nombre, descripcion, estado || 'disponible']
    );
    res.status(201).json({ id: result.insertId, nombre, descripcion, estado });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { nombre, descripcion, estado } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE tools SET nombre = ?, descripcion = ?, estado = ? WHERE id = ?',
      [nombre, descripcion, estado, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Herramienta no encontrada' });
    res.json({ message: 'Herramienta actualizada' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM tools WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Herramienta no encontrada' });
    res.json({ message: 'Herramienta eliminada' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
