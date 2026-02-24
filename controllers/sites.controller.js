const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, c.nombre AS cliente
       FROM sites s
       LEFT JOIN clients c ON s.client_id = c.id
       ORDER BY s.nombre`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, c.nombre AS cliente
       FROM sites s
       LEFT JOIN clients c ON s.client_id = c.id
       WHERE s.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Sitio no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { nombre, direccion, client_id, frecuencia } = req.body;
  if (!nombre || !client_id) {
    return res.status(400).json({ message: 'Nombre y client_id requeridos' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO sites (nombre, direccion, client_id, frecuencia) VALUES (?, ?, ?, ?)',
      [nombre, direccion, client_id, frecuencia]
    );
    res.status(201).json({ id: result.insertId, nombre, direccion, client_id, frecuencia });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { nombre, direccion, client_id, frecuencia } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE sites SET nombre = ?, direccion = ?, client_id = ?, frecuencia = ? WHERE id = ?',
      [nombre, direccion, client_id, frecuencia, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Sitio no encontrado' });
    res.json({ message: 'Sitio actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE sites SET activo = 0 WHERE id = ?',
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Sitio no encontrado' });
    res.json({ message: 'Sitio desactivado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.assignTeam = async (req, res) => {
  const { team_id, fecha_inicio } = req.body;
  if (!team_id) return res.status(400).json({ message: 'team_id requerido' });
  try {
    const [result] = await db.query(
      'INSERT INTO team_site_assignments (site_id, team_id, fecha_inicio) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE team_id = ?, fecha_inicio = ?',
      [req.params.id, team_id, fecha_inicio || new Date(), team_id, fecha_inicio || new Date()]
    );
    res.status(201).json({ message: 'Equipo asignado al sitio' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getComments = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT sc.*, u.nombre AS autor
       FROM site_comments sc
       JOIN users u ON sc.user_id = u.id
       WHERE sc.site_id = ?
       ORDER BY sc.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.addComment = async (req, res) => {
  const { comentario } = req.body;
  if (!comentario) return res.status(400).json({ message: 'Comentario requerido' });
  try {
    const [result] = await db.query(
      'INSERT INTO site_comments (site_id, user_id, comentario) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, comentario]
    );
    res.status(201).json({ id: result.insertId, comentario });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getLogs = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT dsl.*, u.nombre AS limpiador
       FROM daily_site_logs dsl
       JOIN users u ON dsl.user_id = u.id
       WHERE dsl.site_id = ?
       ORDER BY dsl.fecha DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
