const db = require('../config/db');

exports.getAll = async (req, res) => {
  const { fecha, user_id } = req.query;
  let query = `
    SELECT dsl.*, u.nombre AS limpiador, s.nombre AS sitio
    FROM daily_site_logs dsl
    JOIN users u ON dsl.user_id = u.id
    JOIN sites s ON dsl.site_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (fecha) { query += ' AND dsl.fecha = ?'; params.push(fecha); }
  if (user_id) { query += ' AND dsl.user_id = ?'; params.push(user_id); }
  query += ' ORDER BY dsl.fecha DESC, dsl.created_at DESC';

  try {
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT dsl.*, u.nombre AS limpiador, s.nombre AS sitio
       FROM daily_site_logs dsl
       JOIN users u ON dsl.user_id = u.id
       JOIN sites s ON dsl.site_id = s.id
       WHERE dsl.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Log no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { site_id, fecha, horas, bins, notas } = req.body;
  if (!site_id || !fecha) {
    return res.status(400).json({ message: 'site_id y fecha requeridos' });
  }

  try {
    // Cleaners can only log for sites assigned to their team
    const [assigned] = await db.query(
      `SELECT 1 FROM team_site_assignments tsa
       JOIN user_team_history uth ON tsa.team_id = uth.team_id
       WHERE uth.user_id = ? AND tsa.site_id = ? AND uth.fecha_fin IS NULL`,
      [req.user.id, site_id]
    );
    if (assigned.length === 0) {
      return res.status(403).json({ message: 'No tienes asignado este sitio' });
    }

    const [result] = await db.query(
      'INSERT INTO daily_site_logs (site_id, user_id, fecha, horas, bins, notas) VALUES (?, ?, ?, ?, ?, ?)',
      [site_id, req.user.id, fecha, horas, bins, notas]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { horas, bins, notas, confirmado } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE daily_site_logs SET horas = ?, bins = ?, notas = ?, confirmado = ? WHERE id = ?',
      [horas, bins, notas, confirmado, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Log no encontrado' });
    res.json({ message: 'Log actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getToday = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.id, s.nombre, s.direccion, tsa.team_id
       FROM team_site_assignments tsa
       JOIN sites s ON tsa.site_id = s.id
       JOIN user_team_history uth ON tsa.team_id = uth.team_id
       WHERE uth.user_id = ? AND uth.fecha_fin IS NULL AND s.activo = 1`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
