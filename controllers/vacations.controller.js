const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT vr.*, u.nombre AS empleado, u.apellido AS empleado_apellido
       FROM vacation_requests vr
       JOIN users u ON vr.user_id = u.id
       ORDER BY vr.fecha_inicio DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getMine = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM vacation_requests WHERE user_id = ? ORDER BY fecha_inicio DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { fecha_inicio, fecha_fin, dias } = req.body;
  if (!fecha_inicio || !fecha_fin) {
    return res.status(400).json({ message: 'fecha_inicio y fecha_fin requeridos' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO vacation_requests (user_id, fecha_inicio, fecha_fin, dias, estado) VALUES (?, ?, ?, ?, "pendiente")',
      [req.user.id, fecha_inicio, fecha_fin, dias]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.approve = async (req, res) => {
  const { user_id_reemplazo } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT * FROM vacation_requests WHERE id = ? AND estado = "pendiente"',
      [req.params.id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Solicitud no encontrada o ya procesada' });
    }

    await conn.query(
      'UPDATE vacation_requests SET estado = "aprobado" WHERE id = ?',
      [req.params.id]
    );

    if (user_id_reemplazo) {
      const { fecha_inicio, fecha_fin, user_id } = rows[0];
      await conn.query(
        'INSERT INTO vacation_replacements (user_id_reemplazado, user_id_reemplazo, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?)',
        [user_id, user_id_reemplazo, fecha_inicio, fecha_fin]
      );
    }

    await conn.commit();
    res.json({ message: 'Vacación aprobada' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};

exports.reject = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE vacation_requests SET estado = "rechazado" WHERE id = ? AND estado = "pendiente"',
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Solicitud no encontrada o ya procesada' });
    }
    res.json({ message: 'Solicitud rechazada' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
