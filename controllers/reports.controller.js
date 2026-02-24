const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM reports ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM reports WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Reporte no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.generate = async (req, res) => {
  const { fecha_inicio, fecha_fin, user_id } = req.body;
  if (!fecha_inicio || !fecha_fin) {
    return res.status(400).json({ message: 'fecha_inicio y fecha_fin requeridos' });
  }

  try {
    let query = `
      SELECT dsl.user_id, u.nombre, SUM(dsl.horas) AS total_horas, SUM(dsl.bins) AS total_bins, COUNT(*) AS dias_trabajados
      FROM daily_site_logs dsl
      JOIN users u ON dsl.user_id = u.id
      WHERE dsl.fecha BETWEEN ? AND ?
    `;
    const params = [fecha_inicio, fecha_fin];
    if (user_id) { query += ' AND dsl.user_id = ?'; params.push(user_id); }
    query += ' GROUP BY dsl.user_id, u.nombre';

    const [data] = await db.query(query, params);

    const [result] = await db.query(
      'INSERT INTO reports (fecha_inicio, fecha_fin, generado_por, datos) VALUES (?, ?, ?, ?)',
      [fecha_inicio, fecha_fin, req.user.id, JSON.stringify(data)]
    );

    res.status(201).json({ id: result.insertId, fecha_inicio, fecha_fin, data });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.approve = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE reports SET aprobado = 1, aprobado_por = ?, aprobado_at = NOW() WHERE id = ?',
      [req.user.id, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Reporte no encontrado' });
    res.json({ message: 'Reporte aprobado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
