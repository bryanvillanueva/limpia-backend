const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM clients ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Cliente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { nombre, telefono, direccion, contacto_nombre, contacto_email } = req.body;
  if (!nombre) return res.status(400).json({ message: 'Nombre requerido' });

  try {
    const [result] = await db.query(
      'INSERT INTO clients (nombre, telefono, direccion, contacto_nombre, contacto_email) VALUES (?, ?, ?, ?, ?)',
      [nombre, telefono, direccion, contacto_nombre, contacto_email]
    );
    res.status(201).json({ id: result.insertId, nombre, telefono, direccion, contacto_nombre, contacto_email });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { nombre, telefono, direccion, contacto_nombre, contacto_email } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE clients SET nombre = ?, telefono = ?, direccion = ?, contacto_nombre = ?, contacto_email = ? WHERE id = ?',
      [nombre, telefono, direccion, contacto_nombre, contacto_email, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Cliente no encontrado' });
    res.json({ message: 'Cliente actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
