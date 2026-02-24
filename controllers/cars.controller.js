const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM cars ORDER BY placa');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM cars WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Auto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { placa, marca, modelo, anio, estado } = req.body;
  if (!placa) return res.status(400).json({ message: 'Placa requerida' });
  try {
    const [result] = await db.query(
      'INSERT INTO cars (placa, marca, modelo, anio, estado) VALUES (?, ?, ?, ?, ?)',
      [placa, marca, modelo, anio, estado || 'activo']
    );
    res.status(201).json({ id: result.insertId, placa, marca, modelo, anio, estado });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'La placa ya está registrada' });
    }
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { placa, marca, modelo, anio, estado } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE cars SET placa = ?, marca = ?, modelo = ?, anio = ?, estado = ? WHERE id = ?',
      [placa, marca, modelo, anio, estado, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Auto no encontrado' });
    res.json({ message: 'Auto actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
