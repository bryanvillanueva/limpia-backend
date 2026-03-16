const db = require('../config/db');
const xlsx = require('xlsx');

/**
 * Normalizes a header key to compare CSV/XLSX columns safely.
 * @param {string} value - Raw header label.
 * @returns {string} Normalized header key.
 */
function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]+/g, '_');
}

/**
 * Reads the first existing value from a row by alias list.
 * @param {Record<string, any>} row - Imported row object.
 * @param {string[]} aliases - Header aliases to check.
 * @returns {any} Raw value or undefined if not found.
 */
function readByAliases(row, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) {
      return row[alias];
    }
    const normalizedAlias = normalizeHeader(alias);
    const rowKeys = Object.keys(row);
    const matchedKey = rowKeys.find((key) => normalizeHeader(key) === normalizedAlias);
    if (matchedKey) return row[matchedKey];
  }
  return undefined;
}

/**
 * Converts imported values to nullable strings.
 * @param {any} value - Raw cell value.
 * @returns {string | null} Trimmed string or null.
 */
function toNullableString(value) {
  if (value === undefined || value === null) return null;
  const parsed = String(value).trim();
  return parsed === '' ? null : parsed;
}

/**
 * Parses requiere_mantenimiento-style values into 0 or 1.
 * @param {any} value - Raw cell value.
 * @returns {0 | 1} Default 0 when empty or invalid.
 */
function toRequiereMantenimiento(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'si', 'yes'].includes(raw)) return 1;
  return 0;
}

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, te.numero AS equipo_numero
       FROM tools t
       LEFT JOIN teams te ON t.equipo_id = te.id
       ORDER BY t.nombre`
    );
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
  const { nombre, descripcion, requiere_mantenimiento, fecha_ultimo_mantenimiento, precio_unitario, ubicacion, equipo_id } = req.body;
  if (!nombre) return res.status(400).json({ message: 'Nombre requerido' });
  try {
    const [result] = await db.query(
      'INSERT INTO tools (nombre, descripcion, requiere_mantenimiento, fecha_ultimo_mantenimiento, precio_unitario, ubicacion, equipo_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nombre, descripcion, requiere_mantenimiento ? 1 : 0, fecha_ultimo_mantenimiento, precio_unitario, ubicacion, equipo_id]
    );
    res.status(201).json({ id: result.insertId, nombre });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Mass import tools from CSV/XLSX. Tools can be created only (ubicacion oficina) or created and assigned to a team (ubicacion asignada + equipo_id).
 * @param {import('express').Request} req - Must have req.file (multer) with buffer.
 * @param {import('express').Response} res - JSON with imported, failed, errors.
 */
exports.importTools = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Archivo requerido en el campo file (.csv o .xlsx)' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return res.status(400).json({ message: 'El archivo no contiene hojas para importar' });
    }

    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: null });
    if (!rows.length) {
      return res.status(400).json({ message: 'El archivo no contiene filas de datos' });
    }

    const [teamRows] = await db.query('SELECT id FROM teams');
    const validTeamIds = new Set(teamRows.map((t) => t.id));

    const errors = [];
    let imported = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNumber = index + 2;

      const nombre = toNullableString(readByAliases(row, ['nombre', 'name']));
      const code = toNullableString(readByAliases(row, ['code', 'codigo']));
      const descripcion = toNullableString(readByAliases(row, ['descripcion', 'description']));
      const requiere_mantenimiento = toRequiereMantenimiento(readByAliases(row, ['requiere_mantenimiento', 'mantenimiento']));
      const fecha_ultimo_mantenimiento = toNullableString(readByAliases(row, ['fecha_ultimo_mantenimiento', 'fecha_mantenimiento']));
      const rawPrecio = readByAliases(row, ['precio_unitario', 'precio']);
      const ubicacionRaw = toNullableString(readByAliases(row, ['ubicacion', 'location']));
      const rawEquipoId = readByAliases(row, ['equipo_id', 'team_id', 'team']);

      if (!nombre) {
        errors.push({ row: rowNumber, message: 'nombre es requerido' });
        continue;
      }

      const ubicacion = ubicacionRaw ? ubicacionRaw.toLowerCase().trim() : 'oficina';
      if (ubicacion !== 'oficina' && ubicacion !== 'asignada') {
        errors.push({ row: rowNumber, message: 'ubicacion debe ser "oficina" o "asignada"' });
        continue;
      }

      let equipo_id = null;
      if (ubicacion === 'asignada') {
        if (rawEquipoId === undefined || rawEquipoId === null || String(rawEquipoId).trim() === '') {
          errors.push({ row: rowNumber, message: 'equipo_id es requerido cuando ubicacion es asignada' });
          continue;
        }
        const parsedEquipoId = Number(rawEquipoId);
        if (!Number.isInteger(parsedEquipoId) || parsedEquipoId <= 0) {
          errors.push({ row: rowNumber, message: 'equipo_id invalido' });
          continue;
        }
        if (!validTeamIds.has(parsedEquipoId)) {
          errors.push({ row: rowNumber, message: `equipo_id ${parsedEquipoId} no existe` });
          continue;
        }
        equipo_id = parsedEquipoId;
      }

      let precio_unitario = null;
      if (rawPrecio !== undefined && rawPrecio !== null && String(rawPrecio).trim() !== '') {
        const parsed = Number(rawPrecio);
        if (Number.isNaN(parsed)) {
          errors.push({ row: rowNumber, message: 'precio_unitario invalido' });
          continue;
        }
        precio_unitario = parsed;
      }

      try {
        await db.query(
          `INSERT INTO tools (code, nombre, descripcion, requiere_mantenimiento, fecha_ultimo_mantenimiento, precio_unitario, ubicacion, equipo_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [code, nombre, descripcion, requiere_mantenimiento, fecha_ultimo_mantenimiento, precio_unitario, ubicacion, equipo_id]
        );
        imported += 1;
      } catch (err) {
        errors.push({ row: rowNumber, message: err.message });
      }
    }

    const hasErrors = errors.length > 0;
    const statusCode = imported > 0 ? 201 : 400;

    return res.status(statusCode).json({
      message: hasErrors ? 'Importacion completada con observaciones' : 'Importacion completada',
      imported,
      failed: errors.length,
      errors
    });
  } catch (err) {
    return res.status(500).json({ message: 'Error al procesar archivo', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { nombre, descripcion, requiere_mantenimiento, fecha_ultimo_mantenimiento, precio_unitario, ubicacion, equipo_id } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE tools SET nombre = ?, descripcion = ?, requiere_mantenimiento = ?, fecha_ultimo_mantenimiento = ?, precio_unitario = ?, ubicacion = ?, equipo_id = ? WHERE id = ?',
      [nombre, descripcion, requiere_mantenimiento ? 1 : 0, fecha_ultimo_mantenimiento, precio_unitario, ubicacion, equipo_id, req.params.id]
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
