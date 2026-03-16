const db = require('../config/db');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, t.numero AS equipo_numero
       FROM cars c
       LEFT JOIN teams t ON c.equipo_id = t.id
       ORDER BY c.matricula`
    );
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
  const {
    matricula,
    tipo,
    marca,
    modelo,
    version,
    comentarios,
    caracteristicas,
    proximo_mantenimiento_fecha,
    fecha_rego,
    seguro_info,
    equipo_id
  } = req.body;
  if (!matricula) return res.status(400).json({ message: 'Matricula requerida' });
  try {
    const [result] = await db.query(
      'INSERT INTO cars (matricula, tipo, marca, modelo, version, comentarios, caracteristicas, proximo_mantenimiento_fecha, fecha_rego, seguro_info, equipo_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [matricula, tipo, marca, modelo, version, comentarios, caracteristicas, proximo_mantenimiento_fecha, fecha_rego, seguro_info, equipo_id]
    );
    res.status(201).json({ id: result.insertId, matricula });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'La matrícula ya está registrada' });
    }
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const {
    matricula,
    tipo,
    marca,
    modelo,
    version,
    comentarios,
    caracteristicas,
    proximo_mantenimiento_fecha,
    fecha_rego,
    seguro_info,
    equipo_id
  } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE cars SET matricula = ?, tipo = ?, marca = ?, modelo = ?, version = ?, comentarios = ?, caracteristicas = ?, proximo_mantenimiento_fecha = ?, fecha_rego = ?, seguro_info = ?, equipo_id = ? WHERE id = ?',
      [matricula, tipo, marca, modelo, version, comentarios, caracteristicas, proximo_mantenimiento_fecha, fecha_rego, seguro_info, equipo_id, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Auto no encontrado' });
    res.json({ message: 'Auto actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Lists maintenance service history for a specific car.
 * @param {import('express').Request} req - Express request with car id param.
 * @param {import('express').Response} res - Express response.
 * @returns {Promise<void>}
 * Edge cases: returns empty array when the car has no services.
 */
exports.getServicesByCar = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT *
       FROM car_services
       WHERE car_id = ?
       ORDER BY fecha_mantenimiento DESC, id DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Creates a maintenance service entry with car/team snapshot data.
 * @param {import('express').Request} req - Express request with car id and service payload.
 * @param {import('express').Response} res - Express response.
 * @returns {Promise<void>}
 * Edge cases: rejects cars without team assignment because car_services.equipo_id is required.
 */
exports.createService = async (req, res) => {
  const { fecha_mantenimiento, km_mantenimiento, precio, notas, proximo_mantenimiento_fecha } = req.body;

  if (!fecha_mantenimiento) {
    return res.status(400).json({ message: 'fecha_mantenimiento requerida' });
  }

  const conn = await db.getConnection();
  try {
    const [cars] = await conn.query(
      `SELECT c.id, c.equipo_id, c.matricula, c.tipo, c.marca, c.modelo, c.version, t.numero AS equipo_numero
       FROM cars c
       LEFT JOIN teams t ON c.equipo_id = t.id
       WHERE c.id = ?`,
      [req.params.id]
    );

    if (cars.length === 0) {
      return res.status(404).json({ message: 'Auto no encontrado' });
    }

    const car = cars[0];
    if (!car.equipo_id) {
      return res.status(400).json({ message: 'El auto debe estar asignado a un equipo para registrar service' });
    }

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO car_services (
        car_id, equipo_id, car_matricula, car_tipo, car_marca, car_modelo, car_version,
        equipo_numero, fecha_mantenimiento, km_mantenimiento, precio, notas
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        car.id,
        car.equipo_id,
        car.matricula,
        car.tipo,
        car.marca,
        car.modelo,
        car.version,
        car.equipo_numero,
        fecha_mantenimiento,
        km_mantenimiento ?? null,
        precio ?? null,
        notas ?? null
      ]
    );

    if (proximo_mantenimiento_fecha) {
      await conn.query(
        'UPDATE cars SET proximo_mantenimiento_fecha = ? WHERE id = ?',
        [proximo_mantenimiento_fecha, car.id]
      );
    }

    await conn.commit();
    res.status(201).json({
      id: result.insertId,
      message: 'Service registrado',
      car_id: car.id,
      proximo_mantenimiento_fecha: proximo_mantenimiento_fecha || null
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};
