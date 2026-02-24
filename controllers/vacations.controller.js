const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT v.*, u.nombre AS empleado
       FROM vacations v
       JOIN users u ON v.user_id = u.id
       ORDER BY v.fecha_inicio DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getMine = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM vacations WHERE user_id = ? ORDER BY fecha_inicio DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { fecha_inicio, fecha_fin, motivo } = req.body;
  if (!fecha_inicio || !fecha_fin) {
    return res.status(400).json({ message: 'fecha_inicio y fecha_fin requeridos' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO vacations (user_id, fecha_inicio, fecha_fin, motivo, estado) VALUES (?, ?, ?, ?, "pendiente")',
      [req.user.id, fecha_inicio, fecha_fin, motivo]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.approve = async (req, res) => {
  const { reemplazo_user_id } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE vacations SET estado = "aprobado", aprobado_por = ?, reemplazo_user_id = ? WHERE id = ? AND estado = "pendiente"',
      [req.user.id, reemplazo_user_id || null, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Solicitud no encontrada o ya procesada' });
    }
    res.json({ message: 'Vacación aprobada' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.reject = async (req, res) => {
  const { motivo } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE vacations SET estado = "rechazado", motivo_rechazo = ?, aprobado_por = ? WHERE id = ? AND estado = "pendiente"',
      [motivo, req.user.id, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Solicitud no encontrada o ya procesada' });
    }
    res.json({ message: 'Solicitud rechazada' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
