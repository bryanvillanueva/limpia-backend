const db = require('../config/db');
const xlsx = require('xlsx');

/**
 * Normalizes a header key to compare CSV/XLSX columns safely.
 * @param {string} value - Raw header label.
 * @returns {string} Normalized header key.
 * Edge cases: trims spaces, lowercase, and removes accents.
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
 * Edge cases: checks both exact and normalized keys.
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
 * Edge cases: empty values become null to keep DB optional fields clean.
 */
function toNullableString(value) {
  if (value === undefined || value === null) return null;
  const parsed = String(value).trim();
  return parsed === '' ? null : parsed;
}

/**
 * Parses imported values into nullable boolean as 0/1.
 * @param {any} value - Raw cell value.
 * @returns {0 | 1 | null} Parsed active flag.
 * Edge cases: accepts true/false, 1/0, si/no.
 */
function toNullableBoolean(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;

  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'si', 'activo'].includes(raw)) return 1;
  if (['0', 'false', 'no', 'inactivo'].includes(raw)) return 0;
  return null;
}

/**
 * Parses a numeric value from the row; returns null if empty or invalid.
 * @param {any} value - Raw cell value.
 * @returns {number | null}
 */
function toNullableNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parses hace_bins / pago_bins style 0/1 from the row. Default 0 when empty.
 * @param {any} value - Raw cell value.
 * @returns {0 | 1}
 */
function toZeroOne(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'si', 'yes'].includes(raw)) return 1;
  return 0;
}

/**
 * Parses assignment fields from an Excel row when team_id is present.
 * Used for team_site_assignments: frecuencia, horas_por_trabajador, hace_bins, pago_bins, fecha_asignacion, activo.
 * @param {Record<string, any>} row - Imported row object.
 * @returns {{ frecuencia: string | null, horas_por_trabajador: number | null, hace_bins: 0 | 1, pago_bins: number | null, fecha_asignacion: string | null, activo: 0 | 1 }}
 */
function parseAssignmentFromRow(row) {
  const frecuencia = toNullableString(readByAliases(row, ['frecuencia', 'frequency']));
  const horas_por_trabajador = toNullableNumber(readByAliases(row, ['horas_por_trabajador', 'horas_trabajador', 'horas']));
  const hace_bins = toZeroOne(readByAliases(row, ['hace_bins', 'bins']));
  const pago_bins = toNullableNumber(readByAliases(row, ['pago_bins']));
  const fechaRaw = toNullableString(readByAliases(row, ['fecha_asignacion', 'fecha']));
  let fecha_asignacion = fechaRaw;
  if (fechaRaw && !/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
    const d = new Date(fechaRaw);
    if (!Number.isNaN(d.getTime())) fecha_asignacion = d.toISOString().slice(0, 10);
  }
  const activoRaw = readByAliases(row, ['assignment_activo', 'asignacion_activo', 'tsa_activo']);
  const activo = activoRaw !== undefined && activoRaw !== null && String(activoRaw).trim() !== ''
    ? (toZeroOne(activoRaw) ? 1 : 0)
    : 1;
  return { frecuencia, horas_por_trabajador, hace_bins, pago_bins, fecha_asignacion, activo };
}

/**
 * Builds a stable key to match an existing site: normalized direccion_linea1 + cliente_id.
 * @param {string | null} direccion_linea1 - Address line 1.
 * @param {number | null} cliente_id - Client id.
 * @returns {string} Key for lookup.
 */
function siteMatchKey(direccion_linea1, cliente_id) {
  const norm = (String(direccion_linea1 || '').trim().toLowerCase());
  return `${norm}|${cliente_id}`;
}

/**
 * Compares site data fields (excludes team). Used to decide update vs create-new.
 * @param {Object} existing - Existing site row from DB.
 * @param {Object} excel - Parsed Excel row fields (direccion_linea2, suburb, ...).
 * @returns {boolean} True if all comparable fields are equal (null/empty treated as equal).
 */
function siteDataEquals(existing, excel) {
  const eq = (a, b) => {
    const sa = a == null ? '' : String(a).trim();
    const sb = b == null ? '' : String(b).trim();
    return sa === sb;
  };
  const activoExisting = existing.activo != null ? Number(existing.activo) : null;
  const activoExcel = excel.activo != null ? Number(excel.activo) : null;
  const activoEq = activoExcel == null || activoExisting === activoExcel;
  return (
    eq(existing.direccion_linea1, excel.direccion_linea1) &&
    eq(existing.direccion_linea2, excel.direccion_linea2) &&
    eq(existing.suburb, excel.suburb) &&
    eq(existing.state, excel.state) &&
    eq(existing.postcode, excel.postcode) &&
    eq(existing.country, excel.country) &&
    eq(existing.latitud, excel.latitud) &&
    eq(existing.longitud, excel.longitud) &&
    eq(existing.contrato, excel.contrato) &&
    eq(existing.finanzas, excel.finanzas) &&
    activoEq
  );
}

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, c.nombre AS cliente_nombre,
              (SELECT GROUP_CONCAT(t.numero ORDER BY t.numero SEPARATOR ', ')
               FROM team_site_assignments tsa
               JOIN teams t ON tsa.team_id = t.id
               WHERE tsa.site_id = s.id AND tsa.activo = 1
              ) AS equipos
       FROM sites s
       LEFT JOIN clients c ON s.cliente_id = c.id
       ORDER BY s.id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, c.nombre AS cliente_nombre
       FROM sites s
       LEFT JOIN clients c ON s.cliente_id = c.id
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
  const { direccion_linea1, direccion_linea2, suburb, state, postcode, country, latitud, longitud, cliente_id, contrato, finanzas } = req.body;
  if (!direccion_linea1 || !cliente_id) {
    return res.status(400).json({ message: 'direccion_linea1 y cliente_id requeridos' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO sites (direccion_linea1, direccion_linea2, suburb, state, postcode, country, latitud, longitud, cliente_id, contrato, finanzas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [direccion_linea1, direccion_linea2, suburb, state, postcode, country, latitud, longitud, cliente_id, contrato, finanzas]
    );
    res.status(201).json({ id: result.insertId, direccion_linea1, cliente_id });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.importSites = async (req, res) => {
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

    const [clientRows] = await db.query('SELECT id, nombre FROM clients');
    const clientNameMap = new Map();
    const duplicatedClientNames = new Set();

    for (const client of clientRows) {
      const key = normalizeHeader(client.nombre);
      if (clientNameMap.has(key)) {
        duplicatedClientNames.add(key);
      } else {
        clientNameMap.set(key, client.id);
      }
    }

    const [teamRows] = await db.query('SELECT id FROM teams');
    const validTeamIds = new Set(teamRows.map((t) => t.id));

    const [existingSitesRows] = await db.query(
      'SELECT id, direccion_linea1, direccion_linea2, suburb, state, postcode, country, latitud, longitud, cliente_id, contrato, finanzas, activo FROM sites'
    );
    const existingSitesMap = new Map();
    for (const site of existingSitesRows) {
      const key = siteMatchKey(site.direccion_linea1, site.cliente_id);
      if (!existingSitesMap.has(key)) {
        existingSitesMap.set(key, site);
      }
    }

    const errors = [];
    let imported = 0;
    let updated = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNumber = index + 2;

      const direccion_linea1 = toNullableString(readByAliases(row, ['direccion_linea1', 'direccion']));
      const direccion_linea2 = toNullableString(readByAliases(row, ['direccion_linea2']));
      const suburb = toNullableString(readByAliases(row, ['suburb']));
      const state = toNullableString(readByAliases(row, ['state', 'estado']));
      const postcode = toNullableString(readByAliases(row, ['postcode', 'codigo_postal']));
      const country = toNullableString(readByAliases(row, ['country', 'pais']));
      const latitud = toNullableString(readByAliases(row, ['latitud']));
      const longitud = toNullableString(readByAliases(row, ['longitud']));
      const contrato = toNullableString(readByAliases(row, ['contrato']));
      const finanzas = toNullableString(readByAliases(row, ['finanzas']));
      const activo = toNullableBoolean(readByAliases(row, ['activo']));

      const rawClientId = readByAliases(row, ['cliente_id']);
      const rawClientName = toNullableString(readByAliases(row, ['cliente_nombre', 'cliente']));
      const rawTeamId = readByAliases(row, ['team_id', 'team']);

      let cliente_id = null;
      if (rawClientId !== undefined && rawClientId !== null && String(rawClientId).trim() !== '') {
        const parsedClientId = Number(rawClientId);
        if (!Number.isInteger(parsedClientId) || parsedClientId <= 0) {
          errors.push({ row: rowNumber, message: 'cliente_id invalido' });
          continue;
        }
        cliente_id = parsedClientId;
      } else if (rawClientName) {
        const normalizedClientName = normalizeHeader(rawClientName);
        if (duplicatedClientNames.has(normalizedClientName)) {
          errors.push({ row: rowNumber, message: `cliente_nombre duplicado en DB: ${rawClientName}` });
          continue;
        }
        cliente_id = clientNameMap.get(normalizedClientName) || null;
      }

      if (!direccion_linea1 || !cliente_id) {
        errors.push({
          row: rowNumber,
          message: 'direccion_linea1 y cliente_id/cliente_nombre son requeridos'
        });
        continue;
      }

      let team_id = null;
      if (rawTeamId !== undefined && rawTeamId !== null && String(rawTeamId).trim() !== '') {
        const parsedTeamId = Number(rawTeamId);
        if (!Number.isInteger(parsedTeamId) || parsedTeamId <= 0) {
          errors.push({ row: rowNumber, message: 'team_id invalido' });
          continue;
        }
        if (!validTeamIds.has(parsedTeamId)) {
          errors.push({ row: rowNumber, message: `team_id ${parsedTeamId} no existe` });
          continue;
        }
        team_id = parsedTeamId;
      }

      let assignment = null;
      if (team_id != null) {
        assignment = parseAssignmentFromRow(row);
      }

      try {
        const key = siteMatchKey(direccion_linea1, cliente_id);
        const existing = existingSitesMap.get(key);
        const excelData = {
          direccion_linea1,
          direccion_linea2,
          suburb,
          state,
          postcode,
          country,
          latitud,
          longitud,
          contrato,
          finanzas,
          activo
        };

        if (!existing) {
          const [insertResult] = await db.query(
            'INSERT INTO sites (direccion_linea1, direccion_linea2, suburb, state, postcode, country, latitud, longitud, cliente_id, contrato, finanzas, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 1))',
            [direccion_linea1, direccion_linea2, suburb, state, postcode, country, latitud, longitud, cliente_id, contrato, finanzas, activo]
          );
          imported += 1;
          if (team_id != null) {
            const a = assignment;
            await db.query(
              `INSERT INTO team_site_assignments (team_id, site_id, frecuencia, horas_por_trabajador, hace_bins, pago_bins, fecha_asignacion, activo)
               VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?)`,
              [team_id, insertResult.insertId, a.frecuencia, a.horas_por_trabajador, a.hace_bins, a.pago_bins, a.fecha_asignacion, a.activo]
            );
          }
          continue;
        }

        if (!siteDataEquals(existing, excelData)) {
          const [insertResult] = await db.query(
            'INSERT INTO sites (direccion_linea1, direccion_linea2, suburb, state, postcode, country, latitud, longitud, cliente_id, contrato, finanzas, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 1))',
            [direccion_linea1, direccion_linea2, suburb, state, postcode, country, latitud, longitud, cliente_id, contrato, finanzas, activo]
          );
          imported += 1;
          if (team_id != null) {
            const a = assignment;
            await db.query(
              `INSERT INTO team_site_assignments (team_id, site_id, frecuencia, horas_por_trabajador, hace_bins, pago_bins, fecha_asignacion, activo)
               VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?)`,
              [team_id, insertResult.insertId, a.frecuencia, a.horas_por_trabajador, a.hace_bins, a.pago_bins, a.fecha_asignacion, a.activo]
            );
          }
          continue;
        }

        if (team_id != null) {
          const a = assignment;
          await db.query(
            'UPDATE team_site_assignments SET activo = 0 WHERE site_id = ?',
            [existing.id]
          );
          await db.query(
            `INSERT INTO team_site_assignments (team_id, site_id, frecuencia, horas_por_trabajador, hace_bins, pago_bins, fecha_asignacion, activo)
             VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?)
             ON DUPLICATE KEY UPDATE frecuencia = VALUES(frecuencia), horas_por_trabajador = VALUES(horas_por_trabajador), hace_bins = VALUES(hace_bins), pago_bins = VALUES(pago_bins), fecha_asignacion = COALESCE(VALUES(fecha_asignacion), fecha_asignacion), activo = VALUES(activo)`,
            [team_id, existing.id, a.frecuencia, a.horas_por_trabajador, a.hace_bins, a.pago_bins, a.fecha_asignacion, a.activo]
          );
          updated += 1;
        }
      } catch (err) {
        errors.push({
          row: rowNumber,
          message: err.message
        });
      }
    }

    const hasErrors = errors.length > 0;
    const anySuccess = imported > 0 || updated > 0;
    const statusCode = anySuccess ? 201 : 400;

    return res.status(statusCode).json({
      message: hasErrors ? 'Importacion completada con observaciones' : 'Importacion completada',
      imported,
      updated,
      failed: errors.length,
      errors
    });
  } catch (err) {
    return res.status(500).json({ message: 'Error al procesar archivo', error: err.message });
  }
};

/**
 * Returns the sites assigned to the authenticated user's current team.
 * Resolves the team via user_team_history (fecha_fin IS NULL), then
 * fetches active team_site_assignments for that team.
 * @param {import('express').Request} req - req.user.id from JWT.
 * @param {import('express').Response} res - JSON array of assigned sites.
 * Edge cases: user has no active team, team has no assigned sites.
 */
exports.getMySites = async (req, res) => {
  try {
    const [teamRows] = await db.query(
      'SELECT team_id FROM user_team_history WHERE user_id = ? AND fecha_fin IS NULL LIMIT 1',
      [req.user.id]
    );

    if (teamRows.length === 0) {
      return res.json([]);
    }

    const teamId = teamRows[0].team_id;

    const [rows] = await db.query(
      `SELECT s.id, s.direccion_linea1, s.direccion_linea2, s.suburb,
              s.state, s.postcode, s.country, s.latitud, s.longitud,
              c.nombre AS cliente_nombre,
              tsa.frecuencia, tsa.horas_por_trabajador,
              tsa.hace_bins, tsa.pago_bins
       FROM team_site_assignments tsa
       JOIN sites s ON tsa.site_id = s.id
       LEFT JOIN clients c ON s.cliente_id = c.id
       WHERE tsa.team_id = ? AND tsa.activo = 1 AND s.activo = 1
       ORDER BY s.direccion_linea1`,
      [teamId]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { direccion_linea1, direccion_linea2, suburb, state, postcode, country, latitud, longitud, cliente_id, contrato, finanzas } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE sites SET direccion_linea1 = ?, direccion_linea2 = ?, suburb = ?, state = ?, postcode = ?, country = ?, latitud = ?, longitud = ?, cliente_id = ?, contrato = ?, finanzas = ? WHERE id = ?',
      [direccion_linea1, direccion_linea2, suburb, state, postcode, country, latitud, longitud, cliente_id, contrato, finanzas, req.params.id]
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

exports.getAssignments = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT tsa.team_id, tsa.frecuencia, tsa.horas_por_trabajador,
              tsa.hace_bins, tsa.pago_bins, tsa.fecha_asignacion,
              t.numero AS team_numero
       FROM team_site_assignments tsa
       JOIN teams t ON tsa.team_id = t.id
       WHERE tsa.site_id = ? AND tsa.activo = 1`,
      [req.params.id]
    );

    const teamIds = rows.map(r => r.team_id);
    let membersMap = {};
    if (teamIds.length > 0) {
      const [members] = await db.query(
        `SELECT uth.team_id, u.id AS user_id, u.nombre
         FROM user_team_history uth
         JOIN users u ON uth.user_id = u.id
         WHERE uth.team_id IN (?) AND uth.fecha_fin IS NULL`,
        [teamIds]
      );
      for (const m of members) {
        if (!membersMap[m.team_id]) membersMap[m.team_id] = [];
        membersMap[m.team_id].push({ id: m.user_id, nombre: m.nombre });
      }
    }

    const result = rows.map(r => ({
      ...r,
      members: membersMap[r.team_id] || [],
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.assignTeam = async (req, res) => {
  const { team_id, frecuencia, horas_por_trabajador, hace_bins, pago_bins, fecha_asignacion } = req.body;
  if (!team_id) return res.status(400).json({ message: 'team_id requerido' });
  const siteId = req.params.id;

  try {
    const [existing] = await db.query(
      `SELECT id FROM team_site_assignments
       WHERE team_id = ? AND site_id = ? AND activo = 1
       LIMIT 1`,
      [team_id, siteId]
    );

    if (existing.length > 0) {
      await db.query(
        `UPDATE team_site_assignments
         SET frecuencia = COALESCE(?, frecuencia),
             horas_por_trabajador = COALESCE(?, horas_por_trabajador),
             hace_bins = COALESCE(?, hace_bins),
             pago_bins = COALESCE(?, pago_bins),
             fecha_asignacion = COALESCE(?, fecha_asignacion)
         WHERE id = ?`,
        [frecuencia, horas_por_trabajador, hace_bins, pago_bins, fecha_asignacion, existing[0].id]
      );
      return res.json({ message: 'Asignación actualizada' });
    }

    await db.query(
      `INSERT INTO team_site_assignments (team_id, site_id, frecuencia, horas_por_trabajador, hace_bins, pago_bins, fecha_asignacion)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [team_id, siteId, frecuencia ?? null, horas_por_trabajador ?? null, hace_bins ?? 0, pago_bins ?? null, fecha_asignacion ?? null]
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
       JOIN users u ON sc.autor_user_id = u.id
       WHERE sc.site_id = ?
       ORDER BY sc.fecha DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.addComment = async (req, res) => {
  const { comentario, visible_para } = req.body;
  if (!comentario) return res.status(400).json({ message: 'Comentario requerido' });
  try {
    const [result] = await db.query(
      'INSERT INTO site_comments (site_id, autor_user_id, comentario, fecha, visible_para) VALUES (?, ?, ?, CURDATE(), ?)',
      [req.params.id, req.user.id, comentario, visible_para]
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
