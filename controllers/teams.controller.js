const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM teams ORDER BY numero');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [teams] = await db.query('SELECT * FROM teams WHERE id = ?', [req.params.id]);
    if (teams.length === 0) return res.status(404).json({ message: 'Equipo no encontrado' });

    const [members] = await db.query(
      `SELECT u.id, u.nombre, u.apellido, u.email, u.rol, u.email, u.telefono, u.direccion, u.tipo_visa, u.fecha_vencimiento_visa
       FROM user_team_history uth
       JOIN users u ON uth.user_id = u.id
       WHERE uth.team_id = ? AND uth.fecha_fin IS NULL`,
      [req.params.id]
    );

    res.json({ ...teams[0], members });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { numero } = req.body;
  if (!numero) return res.status(400).json({ message: 'Numero requerido' });

  try {
    const [result] = await db.query('INSERT INTO teams (numero) VALUES (?)', [numero]);
    res.status(201).json({ id: result.insertId, numero });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'El número de equipo ya existe' });
    }
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { numero, activo } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE teams SET numero = ?, activo = ? WHERE id = ?',
      [numero, activo, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Equipo no encontrado' });
    res.json({ message: 'Equipo actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.addMember = async (req, res) => {
  const teamId = req.params.id;
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ message: 'user_id requerido' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Check current member count (max 2)
    const [current] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM user_team_history WHERE team_id = ? AND fecha_fin IS NULL',
      [teamId]
    );
    if (current[0].cnt >= 2) {
      await conn.rollback();
      return res.status(409).json({ message: 'El equipo ya tiene 2 miembros (máximo)' });
    }

    // Close previous team assignment for this user
    await conn.query(
      'UPDATE user_team_history SET fecha_fin = CURDATE() WHERE user_id = ? AND fecha_fin IS NULL',
      [user_id]
    );

    // Insert new assignment
    await conn.query(
      'INSERT INTO user_team_history (user_id, team_id, fecha_inicio) VALUES (?, ?, CURDATE())',
      [user_id, teamId]
    );

    await conn.commit();
    res.status(201).json({ message: 'Miembro agregado al equipo' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};

exports.getPortfolio = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT tsa.site_id, tsa.frecuencia, tsa.horas_por_trabajador,
              tsa.hace_bins, tsa.pago_bins, tsa.fecha_asignacion,
              s.direccion_linea1, s.suburb, s.state, s.postcode,
              c.nombre AS cliente_nombre
       FROM team_site_assignments tsa
       JOIN sites s ON tsa.site_id = s.id
       LEFT JOIN clients c ON s.cliente_id = c.id
       WHERE tsa.team_id = ? AND tsa.activo = 1
       ORDER BY s.direccion_linea1`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getCars = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, matricula, tipo, marca, modelo, version, comentarios, caracteristicas, proximo_mantenimiento_fecha, fecha_rego, seguro_info
       FROM cars
       WHERE equipo_id = ?
       ORDER BY matricula`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Returns tools assigned to the team (tools.equipo_id = team id).
 * @param {import('express').Request} req - req.params.id is the team id.
 * @param {import('express').Response} res - JSON array of tools.
 */
exports.getTools = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT *
       FROM tools
       WHERE equipo_id = ?
       ORDER BY nombre`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.removeMember = async (req, res) => {
  const { id: teamId, userId } = req.params;
  try {
    const [result] = await db.query(
      'UPDATE user_team_history SET fecha_fin = CURDATE() WHERE team_id = ? AND user_id = ? AND fecha_fin IS NULL',
      [teamId, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Miembro no encontrado en el equipo' });
    }
    res.json({ message: 'Miembro removido del equipo' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
