const db = require('../config/db');
const billingCycle = require('../services/billingCycle.service');

/**
 * Returns the active team_id for the authenticated user.
 * @param {number} userId - Authenticated user id.
 * @returns {Promise<number|null>} Active team id or null.
 */
async function getCurrentUserTeamId(userId) {
  const [rows] = await db.query(
    `SELECT team_id
     FROM user_team_history
     WHERE user_id = ? AND fecha_fin IS NULL
     LIMIT 1`,
    [userId]
  );
  return rows.length > 0 ? Number(rows[0].team_id) : null;
}

/**
 * Resolves the active assignment for a user and site.
 * @param {number} userId - Authenticated user id.
 * @param {number} siteId - Target site id.
 * @returns {Promise<object|null>} Assignment row or null.
 */
async function getAssignmentForUserSite(userId, siteId) {
  const [rows] = await db.query(
    `SELECT tsa.id AS assignment_id, tsa.team_id, tsa.horas_por_trabajador,
            tsa.hace_bins, tsa.pago_bins
     FROM team_site_assignments tsa
     JOIN user_team_history uth ON tsa.team_id = uth.team_id
     WHERE uth.user_id = ?
       AND uth.fecha_fin IS NULL
       AND tsa.site_id = ?
       AND tsa.activo = 1
     LIMIT 1`,
    [userId, siteId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Resolves billing week id for the given date.
 * @param {string} fecha - Date in YYYY-MM-DD.
 * @returns {Promise<number|null>} Billing week id or null.
 */
async function getBillingWeekIdByDate(fecha) {
  const [rows] = await db.query(
    `SELECT id
     FROM billing_weeks
     WHERE ? BETWEEN start_date AND end_date
     LIMIT 1`,
    [fecha]
  );
  return rows.length > 0 ? Number(rows[0].id) : null;
}

/**
 * Resolves week range used for teammate comparison/import.
 * Accepts:
 * - billing_week_id, OR
 * - date (YYYY-MM-DD) to resolve its billing week, OR
 * - fecha_inicio + fecha_fin as explicit range.
 * @param {object} input - req.query or req.body payload.
 * @returns {Promise<{billingWeekId:number|null, fechaInicio:string, fechaFin:string}|null>}
 */
async function resolveImportRange(input) {
  const billingWeekId = input.billing_week_id ? Number(input.billing_week_id) : null;
  const date = input.date || null;
  const fechaInicio = input.fecha_inicio || null;
  const fechaFin = input.fecha_fin || null;

  if (billingWeekId) {
    const [rows] = await db.query(
      `SELECT id, start_date, end_date
       FROM billing_weeks
       WHERE id = ?
       LIMIT 1`,
      [billingWeekId]
    );
    if (rows.length === 0) return null;
    return {
      billingWeekId: Number(rows[0].id),
      fechaInicio: rows[0].start_date,
      fechaFin: rows[0].end_date,
    };
  }

  if (date) {
    const week = await billingCycle.getWeekByDate(date);
    if (!week) return null;
    return {
      billingWeekId: Number(week.id),
      fechaInicio: week.start_date,
      fechaFin: week.end_date,
    };
  }

  if (fechaInicio && fechaFin) {
    return {
      billingWeekId: null,
      fechaInicio,
      fechaFin,
    };
  }

  return null;
}

/**
 * Returns active teammates for the authenticated cleaner.
 * @param {number} userId - Authenticated user id.
 * @returns {Promise<{teamId:number|null, teammates:Array}>}
 */
async function getActiveTeamWithTeammates(userId) {
  const teamId = await getCurrentUserTeamId(userId);
  if (!teamId) return { teamId: null, teammates: [] };

  const [rows] = await db.query(
    `SELECT u.id, u.nombre, u.apellido
     FROM user_team_history uth
     JOIN users u ON u.id = uth.user_id
     WHERE uth.team_id = ? AND uth.fecha_fin IS NULL AND uth.user_id <> ?
     ORDER BY u.id`,
    [teamId, userId]
  );

  return {
    teamId: Number(teamId),
    teammates: rows.map((row) => ({
      id: Number(row.id),
      nombre: row.nombre,
      apellido: row.apellido,
    })),
  };
}

/**
 * Resolves source teammate to import logs from.
 * @param {number} userId - Authenticated cleaner id.
 * @param {number|null} sourceUserId - Optional explicit teammate id.
 * @returns {Promise<{teamId:number, sourceUser:object, teammates:Array}|null>}
 */
async function resolveSourceTeammate(userId, sourceUserId) {
  const teamContext = await getActiveTeamWithTeammates(userId);
  if (!teamContext.teamId) return null;

  if (teamContext.teammates.length === 0) {
    return { teamId: teamContext.teamId, sourceUser: null, teammates: [] };
  }

  if (sourceUserId) {
    const sourceUser = teamContext.teammates.find((mate) => Number(mate.id) === Number(sourceUserId));
    if (!sourceUser) return null;
    return { teamId: teamContext.teamId, sourceUser, teammates: teamContext.teammates };
  }

  if (teamContext.teammates.length === 1) {
    return {
      teamId: teamContext.teamId,
      sourceUser: teamContext.teammates[0],
      teammates: teamContext.teammates,
    };
  }

  return { teamId: teamContext.teamId, sourceUser: null, teammates: teamContext.teammates };
}

/**
 * Generates a deterministic key for matching logs by site/date/type.
 * @param {object} log - daily_site_logs row.
 * @returns {string}
 */
function getLogMatchKey(log) {
  const typeKey = log.entry_type == null ? '__NULL__' : String(log.entry_type);
  return `${Number(log.site_id)}|${log.fecha}|${typeKey}`;
}

/**
 * Computes display/legacy values from entry_type + assignment/custom value.
 * @param {object|null} assignment - Active assignment row.
 * @param {string|null} entryType - SERVICE | BINS | CUSTOM | null.
 * @param {number|null} customDisplayValue - Optional custom value.
 * @param {number|null} horasTrabajadasInput - Raw horas from body.
 * @param {boolean|number|null} soloBinsInput - Raw solo_bins from body.
 * @returns {{displayValue:number|null, horasTrabajadas:number, soloBins:number}}
 */
function computeLogValues(assignment, entryType, customDisplayValue, horasTrabajadasInput, soloBinsInput) {
  if (!entryType) {
    const fallbackHoras = Number(horasTrabajadasInput || 0);
    const fallbackSoloBins = soloBinsInput ? 1 : 0;
    return {
      displayValue: customDisplayValue != null ? Number(customDisplayValue) : fallbackHoras,
      horasTrabajadas: fallbackHoras,
      soloBins: fallbackSoloBins,
    };
  }

  if (entryType === 'CUSTOM') {
    const value = Number(customDisplayValue);
    return {
      displayValue: value,
      horasTrabajadas: value,
      soloBins: 0,
    };
  }

  if (entryType === 'SERVICE') {
    const value = Number(assignment?.horas_por_trabajador ?? horasTrabajadasInput ?? 0);
    return {
      displayValue: value,
      horasTrabajadas: value,
      soloBins: 0,
    };
  }

  const value = Number(assignment?.pago_bins ?? customDisplayValue ?? 0);
  return {
    displayValue: value,
    horasTrabajadas: Number(horasTrabajadasInput || 0),
    soloBins: 1,
  };
}

exports.getAll = async (req, res) => {
  const { fecha, user_id } = req.query;
  let query = `
    SELECT dsl.*, DATE_FORMAT(dsl.fecha, '%Y-%m-%d') AS fecha,
           u.nombre AS limpiador, s.direccion_linea1 AS sitio
    FROM daily_site_logs dsl
    JOIN users u ON dsl.user_id = u.id
    JOIN sites s ON dsl.site_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (fecha) { query += ' AND dsl.fecha = ?'; params.push(fecha); }
  if (user_id) { query += ' AND dsl.user_id = ?'; params.push(user_id); }
  query += ' ORDER BY dsl.fecha DESC';

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
      `SELECT dsl.*, DATE_FORMAT(dsl.fecha, '%Y-%m-%d') AS fecha,
              u.nombre AS limpiador, s.direccion_linea1 AS sitio
       FROM daily_site_logs dsl
       JOIN users u ON dsl.user_id = u.id
       JOIN sites s ON dsl.site_id = s.id
       WHERE dsl.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Log no encontrado' });

    const log = rows[0];
    if (req.user.rol === 'cleaner') {
      const cleanerTeamId = await getCurrentUserTeamId(req.user.id);
      if (cleanerTeamId == null || Number(cleanerTeamId) !== Number(log.team_id)) {
        return res.status(403).json({ message: 'No tienes acceso a este log' });
      }
    }

    res.json(log);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const {
    site_id,
    fecha,
    horas_trabajadas,
    solo_bins,
    observaciones,
    entry_type,
    display_value,
  } = req.body;
  if (!site_id || !fecha) {
    return res.status(400).json({ message: 'site_id y fecha requeridos' });
  }
  if (entry_type && !['SERVICE', 'BINS', 'CUSTOM'].includes(entry_type)) {
    return res.status(400).json({ message: 'entry_type debe ser SERVICE, BINS o CUSTOM' });
  }
  if (entry_type === 'CUSTOM' && (display_value === undefined || display_value === null || display_value === '')) {
    return res.status(400).json({ message: 'display_value es requerido para entry_type CUSTOM' });
  }
  if (display_value !== undefined && display_value !== null && (Number.isNaN(Number(display_value)) || Number(display_value) < 0)) {
    return res.status(400).json({ message: 'display_value debe ser un número mayor o igual a 0' });
  }

  try {
    const assignment = await getAssignmentForUserSite(req.user.id, site_id);
    if (!assignment) {
      return res.status(403).json({ message: 'No tienes asignado este sitio' });
    }
    if (entry_type === 'BINS' && !assignment.hace_bins) {
      return res.status(400).json({ message: 'Este sitio no tiene bins habilitados (hace_bins = 0)' });
    }

    const billingWeekId = await getBillingWeekIdByDate(fecha);
    if (!billingWeekId) {
      return res.status(400).json({ message: 'No existe una semana de facturación para esa fecha' });
    }

    const values = computeLogValues(
      assignment,
      entry_type || null,
      display_value !== undefined && display_value !== null && display_value !== '' ? Number(display_value) : null,
      horas_trabajadas,
      solo_bins
    );

    const [existing] = await db.query(
      `SELECT id
       FROM daily_site_logs
       WHERE user_id = ? AND site_id = ? AND fecha = ? AND entry_type = ?
       LIMIT 1`,
      [req.user.id, site_id, fecha, entry_type || null]
    );

    if (existing.length > 0) {
      await db.query(
        `UPDATE daily_site_logs
         SET team_id = ?, horas_trabajadas = ?, solo_bins = ?, observaciones = ?,
             estado = 'pendiente', billing_week_id = ?, entry_type = ?, display_value = ?
         WHERE id = ?`,
        [
          assignment.team_id,
          values.horasTrabajadas,
          values.soloBins,
          observaciones || null,
          billingWeekId,
          entry_type || null,
          values.displayValue,
          existing[0].id,
        ]
      );
      return res.json({ id: existing[0].id, message: 'Log actualizado para la fecha indicada' });
    }

    const [result] = await db.query(
      `INSERT INTO daily_site_logs
       (user_id, team_id, site_id, fecha, horas_trabajadas, solo_bins, observaciones, estado, billing_week_id, entry_type, display_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
      [
        req.user.id,
        assignment.team_id,
        site_id,
        fecha,
        values.horasTrabajadas,
        values.soloBins,
        observaciones || null,
        billingWeekId,
        entry_type || null,
        values.displayValue,
      ]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const {
    horas_trabajadas,
    solo_bins,
    observaciones,
    estado,
    entry_type,
    display_value,
    fecha,
  } = req.body;

  if (entry_type && !['SERVICE', 'BINS', 'CUSTOM'].includes(entry_type)) {
    return res.status(400).json({ message: 'entry_type debe ser SERVICE, BINS o CUSTOM' });
  }
  if (entry_type === 'CUSTOM' && (display_value === undefined || display_value === null || display_value === '')) {
    return res.status(400).json({ message: 'display_value es requerido para entry_type CUSTOM' });
  }
  if (display_value !== undefined && display_value !== null && (Number.isNaN(Number(display_value)) || Number(display_value) < 0)) {
    return res.status(400).json({ message: 'display_value debe ser un número mayor o igual a 0' });
  }

  try {
    const [currentRows] = await db.query(
      `SELECT id, user_id, team_id, site_id, fecha, horas_trabajadas, solo_bins,
              observaciones, estado, entry_type, display_value
       FROM daily_site_logs
       WHERE id = ?`,
      [req.params.id]
    );
    if (currentRows.length === 0) return res.status(404).json({ message: 'Log no encontrado' });

    const current = currentRows[0];
    if (req.user.rol === 'cleaner' && Number(current.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Solo puedes editar tus propios logs' });
    }

    const nextFecha = fecha || current.fecha;
    const billingWeekId = await getBillingWeekIdByDate(nextFecha);
    if (!billingWeekId) {
      return res.status(400).json({ message: 'No existe una semana de facturación para esa fecha' });
    }

    const nextEntryType = entry_type !== undefined ? entry_type : current.entry_type;
    const customDisplayValue = display_value !== undefined
      ? Number(display_value)
      : (current.display_value !== null ? Number(current.display_value) : null);

    let assignment = null;
    if (nextEntryType === 'SERVICE' || nextEntryType === 'BINS') {
      assignment = await getAssignmentForUserSite(current.user_id, current.site_id);
      if (!assignment) {
        return res.status(404).json({ message: 'No existe asignación activa para este sitio/equipo' });
      }
      if (nextEntryType === 'BINS' && !assignment.hace_bins) {
        return res.status(400).json({ message: 'Este sitio no tiene bins habilitados (hace_bins = 0)' });
      }
    }

    const values = computeLogValues(
      assignment,
      nextEntryType || null,
      display_value !== undefined ? Number(display_value) : customDisplayValue,
      horas_trabajadas !== undefined ? horas_trabajadas : current.horas_trabajadas,
      solo_bins !== undefined ? solo_bins : current.solo_bins
    );

    const [result] = await db.query(
      `UPDATE daily_site_logs
       SET fecha = ?, horas_trabajadas = ?, solo_bins = ?, observaciones = ?,
           estado = ?, billing_week_id = ?, entry_type = ?, display_value = ?
       WHERE id = ?`,
      [
        nextFecha,
        values.horasTrabajadas,
        values.soloBins,
        observaciones !== undefined ? observaciones : current.observaciones,
        estado || current.estado,
        billingWeekId,
        nextEntryType,
        values.displayValue,
        req.params.id,
      ]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Log no encontrado' });
    res.json({ message: 'Log actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Returns the authenticated user's own daily_site_logs.
 * Each cleaner sees only their records — even if a site is assigned to
 * multiple teams, they will never see another user's entries.
 * @param {import('express').Request} req - req.user.id from JWT. Optional query: site_id, fecha.
 * @param {import('express').Response} res - JSON array of the user's logs with site info.
 * Edge cases: no logs yet returns [].
 */
exports.getMyLogs = async (req, res) => {
  const { site_id, fecha } = req.query;

  let query = `
    SELECT dsl.*, DATE_FORMAT(dsl.fecha, '%Y-%m-%d') AS fecha,
           s.direccion_linea1 AS sitio, s.suburb,
           c.nombre AS cliente_nombre, t.numero AS team_numero
    FROM daily_site_logs dsl
    JOIN sites s ON dsl.site_id = s.id
    LEFT JOIN clients c ON s.cliente_id = c.id
    LEFT JOIN teams t ON dsl.team_id = t.id
    WHERE dsl.user_id = ?
  `;
  const params = [req.user.id];

  if (site_id) { query += ' AND dsl.site_id = ?'; params.push(site_id); }
  if (fecha) { query += ' AND dsl.fecha = ?'; params.push(fecha); }
  query += ' ORDER BY dsl.fecha DESC';

  try {
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Returns the active team logs for the authenticated cleaner.
 * Optional query filters: fecha, site_id, user_id.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.getTeamLogs = async (req, res) => {
  const { fecha, site_id, user_id } = req.query;

  try {
    const teamId = await getCurrentUserTeamId(req.user.id);
    if (!teamId) return res.json([]);

    let query = `
      SELECT dsl.*, DATE_FORMAT(dsl.fecha, '%Y-%m-%d') AS fecha,
             u.nombre AS limpiador, s.direccion_linea1 AS sitio, c.nombre AS cliente_nombre
      FROM daily_site_logs dsl
      JOIN users u ON dsl.user_id = u.id
      JOIN sites s ON dsl.site_id = s.id
      LEFT JOIN clients c ON s.cliente_id = c.id
      WHERE dsl.team_id = ?
    `;
    const params = [teamId];

    if (fecha) { query += ' AND dsl.fecha = ?'; params.push(fecha); }
    if (site_id) { query += ' AND dsl.site_id = ?'; params.push(site_id); }
    if (user_id) { query += ' AND dsl.user_id = ?'; params.push(user_id); }
    query += ' ORDER BY dsl.fecha DESC, dsl.id DESC';

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Compares teammate logs against current user's logs for a week/range.
 * Query:
 * - source_user_id (optional if only one teammate),
 * - billing_week_id OR date OR fecha_inicio+fecha_fin.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.getImportPreview = async (req, res) => {
  const sourceUserId = req.query.source_user_id ? Number(req.query.source_user_id) : null;
  if (sourceUserId !== null && (!Number.isInteger(sourceUserId) || sourceUserId <= 0)) {
    return res.status(400).json({ message: 'source_user_id inválido' });
  }

  try {
    const range = await resolveImportRange(req.query);
    if (!range) {
      return res.status(400).json({ message: 'Envía billing_week_id o date o fecha_inicio + fecha_fin' });
    }

    const sourceContext = await resolveSourceTeammate(req.user.id, sourceUserId);
    if (!sourceContext || !sourceContext.teamId) {
      return res.status(404).json({ message: 'No tienes un equipo activo o el teammate indicado no es válido' });
    }
    if (!sourceContext.sourceUser) {
      return res.status(400).json({
        message: 'Debe especificar source_user_id',
        teammates: sourceContext.teammates,
      });
    }

    const [sourceLogs] = await db.query(
      `SELECT dsl.id, dsl.user_id, dsl.team_id, dsl.site_id,
              DATE_FORMAT(dsl.fecha, '%Y-%m-%d') AS fecha,
              dsl.horas_trabajadas, dsl.solo_bins, dsl.observaciones, dsl.estado,
              dsl.billing_week_id, dsl.entry_type, dsl.display_value,
              s.direccion_linea1 AS sitio, c.nombre AS cliente_nombre
       FROM daily_site_logs dsl
       JOIN sites s ON dsl.site_id = s.id
       LEFT JOIN clients c ON s.cliente_id = c.id
       WHERE dsl.user_id = ?
         AND dsl.team_id = ?
         AND dsl.fecha BETWEEN ? AND ?
       ORDER BY dsl.fecha, dsl.id`,
      [sourceContext.sourceUser.id, sourceContext.teamId, range.fechaInicio, range.fechaFin]
    );

    const [myLogs] = await db.query(
      `SELECT id, user_id, site_id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, entry_type, estado
       FROM daily_site_logs
       WHERE user_id = ? AND fecha BETWEEN ? AND ?`,
      [req.user.id, range.fechaInicio, range.fechaFin]
    );

    const myLogsByKey = new Map(myLogs.map((log) => [getLogMatchKey(log), log]));
    const comparison = sourceLogs.map((sourceLog) => {
      const currentLog = myLogsByKey.get(getLogMatchKey(sourceLog)) || null;
      return {
        source_log: sourceLog,
        current_log_id: currentLog ? Number(currentLog.id) : null,
        current_log_estado: currentLog ? currentLog.estado : null,
        action: currentLog ? 'update' : 'create',
      };
    });

    const toCreate = comparison.filter((item) => item.action === 'create').length;
    const toUpdate = comparison.length - toCreate;

    return res.json({
      billing_week_id: range.billingWeekId,
      fecha_inicio: range.fechaInicio,
      fecha_fin: range.fechaFin,
      source_user: sourceContext.sourceUser,
      summary: {
        source_logs_total: sourceLogs.length,
        create_count: toCreate,
        update_count: toUpdate,
      },
      comparisons: comparison,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Core import logic that can run in dry-run (no DB writes) or real mode.
 * @param {object} options - Import options.
 * @returns {Promise<object>} Summary payload.
 */
async function runTeammateImport({
  currentUserId,
  payload,
  dryRun,
}) {
  const sourceUserId = payload.source_user_id ? Number(payload.source_user_id) : null;
  const overwriteExisting = Boolean(payload.overwrite_existing);
  if (sourceUserId !== null && (!Number.isInteger(sourceUserId) || sourceUserId <= 0)) {
    return { error: { status: 400, message: 'source_user_id inválido' } };
  }

  const range = await resolveImportRange(payload);
  if (!range) {
    return { error: { status: 400, message: 'Envía billing_week_id o date o fecha_inicio + fecha_fin' } };
  }

  const sourceContext = await resolveSourceTeammate(currentUserId, sourceUserId);
  if (!sourceContext || !sourceContext.teamId) {
    return { error: { status: 404, message: 'No tienes un equipo activo o el teammate indicado no es válido' } };
  }
  if (!sourceContext.sourceUser) {
    return {
      error: {
        status: 400,
        message: 'Debe especificar source_user_id',
        details: { teammates: sourceContext.teammates },
      },
    };
  }

  const conn = await db.getConnection();
  try {
    const [sourceLogs] = await conn.query(
      `SELECT id, team_id, site_id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
              horas_trabajadas, solo_bins, observaciones, estado,
              billing_week_id, entry_type, display_value
       FROM daily_site_logs
       WHERE user_id = ?
         AND team_id = ?
         AND fecha BETWEEN ? AND ?
       ORDER BY fecha, id`,
      [sourceContext.sourceUser.id, sourceContext.teamId, range.fechaInicio, range.fechaFin]
    );

    if (sourceLogs.length === 0) {
      return {
        billing_week_id: range.billingWeekId,
        fecha_inicio: range.fechaInicio,
        fecha_fin: range.fechaFin,
        source_user: sourceContext.sourceUser,
        overwrite_existing: overwriteExisting,
        dry_run: dryRun,
        summary: {
          source_logs_total: 0,
          created: 0,
          updated: 0,
          skipped_existing: 0,
          skipped_confirmed: 0,
        },
      };
    }

    let created = 0;
    let updated = 0;
    let skippedExisting = 0;
    let skippedConfirmed = 0;

    if (!dryRun) {
      await conn.beginTransaction();
    }

    for (const sourceLog of sourceLogs) {
      const [existingRows] = await conn.query(
        `SELECT id, estado
         FROM daily_site_logs
         WHERE user_id = ?
           AND site_id = ?
           AND fecha = ?
           AND (entry_type <=> ?)
         LIMIT 1`,
        [currentUserId, sourceLog.site_id, sourceLog.fecha, sourceLog.entry_type]
      );

      const billingWeekIdToUse = sourceLog.billing_week_id || range.billingWeekId || null;

      if (existingRows.length > 0) {
        const existing = existingRows[0];
        if (!overwriteExisting) {
          skippedExisting += 1;
          continue;
        }
        if (existing.estado === 'confirmado') {
          skippedConfirmed += 1;
          continue;
        }

        if (!dryRun) {
          await conn.query(
            `UPDATE daily_site_logs
             SET team_id = ?, horas_trabajadas = ?, solo_bins = ?, observaciones = ?,
                 estado = 'pendiente', billing_week_id = ?, entry_type = ?, display_value = ?
             WHERE id = ?`,
            [
              sourceContext.teamId,
              sourceLog.horas_trabajadas,
              sourceLog.solo_bins,
              sourceLog.observaciones,
              billingWeekIdToUse,
              sourceLog.entry_type,
              sourceLog.display_value,
              existing.id,
            ]
          );
        }
        updated += 1;
      } else {
        if (!dryRun) {
          await conn.query(
            `INSERT INTO daily_site_logs
             (user_id, team_id, site_id, fecha, horas_trabajadas, solo_bins, observaciones, estado, billing_week_id, entry_type, display_value)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
            [
              currentUserId,
              sourceContext.teamId,
              sourceLog.site_id,
              sourceLog.fecha,
              sourceLog.horas_trabajadas,
              sourceLog.solo_bins,
              sourceLog.observaciones,
              billingWeekIdToUse,
              sourceLog.entry_type,
              sourceLog.display_value,
            ]
          );
        }
        created += 1;
      }
    }

    if (!dryRun) {
      await conn.commit();
    }

    return {
      billing_week_id: range.billingWeekId,
      fecha_inicio: range.fechaInicio,
      fecha_fin: range.fechaFin,
      source_user: sourceContext.sourceUser,
      overwrite_existing: overwriteExisting,
      dry_run: dryRun,
      summary: {
        source_logs_total: sourceLogs.length,
        created,
        updated,
        skipped_existing: skippedExisting,
        skipped_confirmed: skippedConfirmed,
      },
    };
  } catch (err) {
    if (!dryRun) {
      await conn.rollback();
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Imports teammate logs into the authenticated cleaner for a week/range.
 * Supports dry-run mode for preview using the same logic.
 * Body:
 * - source_user_id (optional if only one teammate),
 * - billing_week_id OR date OR fecha_inicio+fecha_fin,
 * - overwrite_existing (optional, default false),
 * - dry_run (optional, default false).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.importFromTeammate = async (req, res) => {
  const dryRun = Boolean(req.body.dry_run);
  try {
    const result = await runTeammateImport({
      currentUserId: req.user.id,
      payload: req.body,
      dryRun,
    });

    if (result.error) {
      const status = result.error.status || 400;
      const body = { message: result.error.message };
      if (result.error.details) {
        Object.assign(body, result.error.details);
      }
      return res.status(status).json(body);
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getToday = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.id, s.direccion_linea1, s.direccion_linea2, s.suburb, tsa.team_id, tsa.horas_por_trabajador, tsa.hace_bins
       FROM team_site_assignments tsa
       JOIN sites s ON tsa.site_id = s.id
       JOIN user_team_history uth ON tsa.team_id = uth.team_id
       WHERE uth.user_id = ? AND uth.fecha_fin IS NULL AND tsa.activo = 1 AND s.activo = 1`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Deletes a daily_site_log by id.
 * - Cleaners can delete only their own logs.
 * - Managers can delete any log.
 * - Confirmed logs cannot be deleted to avoid breaking billing/reports.
 * @param {import('express').Request} req - Expects :id param and req.user from auth middleware.
 * @param {import('express').Response} res - Returns status/message about the deletion.
 */
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, user_id, estado
       FROM daily_site_logs
       WHERE id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Log no encontrado' });
    }

    const log = rows[0];

    if (req.user.rol === 'cleaner' && Number(log.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Solo puedes eliminar tus propios logs' });
    }

    if (log.estado === 'confirmado') {
      return res.status(400).json({ message: 'No puedes eliminar un log confirmado' });
    }

    const [result] = await db.query(
      `DELETE FROM daily_site_logs
       WHERE id = ?`,
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Log no encontrado' });
    }

    return res.json({ message: 'Log eliminado' });
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
