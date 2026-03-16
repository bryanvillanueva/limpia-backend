const db = require('../config/db');
const billingCycle = require('../services/billingCycle.service');

/**
 * Returns true when the role has global report access.
 * @param {string} rol - Role from req.user.
 * @returns {boolean}
 */
function canAccessAllReports(rol) {
  return ['admin', 'accountant'].includes(rol);
}

/**
 * Resolves reporting date range from body.
 * Accepts billing_period_id OR explicit fecha_inicio/fecha_fin.
 * @param {number|null} billingPeriodId - Optional period id.
 * @param {string|null} fechaInicio - Optional start date.
 * @param {string|null} fechaFin - Optional end date.
 * @returns {Promise<{billingPeriodId:number|null, fechaInicio:string, fechaFin:string}>}
 */
async function resolveRange(billingPeriodId, fechaInicio, fechaFin) {
  if (billingPeriodId) {
    const period = await billingCycle.getPeriodById(billingPeriodId);
    if (!period) return null;
    return {
      billingPeriodId: Number(period.id),
      fechaInicio: period.start_date,
      fechaFin: period.end_date,
    };
  }

  if (!fechaInicio || !fechaFin) return null;

  const [periodRows] = await db.query(
    `SELECT id
     FROM billing_periods
     WHERE start_date = ? AND end_date = ?
     LIMIT 1`,
    [fechaInicio, fechaFin]
  );

  return {
    billingPeriodId: periodRows.length > 0 ? Number(periodRows[0].id) : null,
    fechaInicio,
    fechaFin,
  };
}

/**
 * Builds report summary and detail from selected logs.
 * @param {number} userId - Owner user id.
 * @param {string} fechaInicio - Start date.
 * @param {string} fechaFin - End date.
 * @param {number[]} excludedLogIds - Logs excluded by user.
 * @returns {Promise<{summary: object, included_logs: Array}>}
 */
async function buildReportData(userId, fechaInicio, fechaFin, excludedLogIds) {
  let detailQuery = `
    SELECT dsl.id, dsl.user_id, dsl.team_id, dsl.site_id,
           DATE_FORMAT(dsl.fecha, '%Y-%m-%d') AS fecha,
           dsl.horas_trabajadas, dsl.solo_bins, dsl.observaciones, dsl.estado,
           dsl.entry_type, dsl.display_value,
           s.direccion_linea1 AS sitio, c.nombre AS cliente_nombre
    FROM daily_site_logs dsl
    JOIN sites s ON dsl.site_id = s.id
    LEFT JOIN clients c ON s.cliente_id = c.id
    WHERE dsl.user_id = ? AND dsl.fecha BETWEEN ? AND ?
  `;
  const detailParams = [userId, fechaInicio, fechaFin];
  if (excludedLogIds.length > 0) {
    detailQuery += ' AND dsl.id NOT IN (?)';
    detailParams.push(excludedLogIds);
  }
  detailQuery += ' ORDER BY dsl.fecha, dsl.id';
  const [includedLogs] = await db.query(detailQuery, detailParams);

  let summaryQuery = `
    SELECT dsl.user_id,
           u.nombre,
           u.apellido,
           COUNT(*) AS total_logs,
           SUM(CASE WHEN dsl.entry_type = 'BINS' OR dsl.solo_bins = 1 THEN 1 ELSE 0 END) AS total_bins_entries,
           SUM(COALESCE(dsl.display_value, dsl.horas_trabajadas, 0)) AS total_valor
    FROM daily_site_logs dsl
    JOIN users u ON dsl.user_id = u.id
    WHERE dsl.user_id = ? AND dsl.fecha BETWEEN ? AND ?
  `;
  const summaryParams = [userId, fechaInicio, fechaFin];
  if (excludedLogIds.length > 0) {
    summaryQuery += ' AND dsl.id NOT IN (?)';
    summaryParams.push(excludedLogIds);
  }
  summaryQuery += ' GROUP BY dsl.user_id, u.nombre, u.apellido';

  const [summaryRows] = await db.query(summaryQuery, summaryParams);
  const summary = summaryRows.length > 0
    ? summaryRows[0]
    : {
        user_id: userId,
        nombre: null,
        apellido: null,
        total_logs: 0,
        total_bins_entries: 0,
        total_valor: 0,
      };

  return { summary, included_logs: includedLogs };
}

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, u.nombre AS generado_por, bp.start_date AS period_start, bp.end_date AS period_end
       FROM reports r
       JOIN users u ON r.user_id = u.id
       LEFT JOIN billing_periods bp ON r.billing_period_id = bp.id
       ORDER BY r.id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, u.nombre AS generado_por, u.apellido AS generado_por_apellido
       FROM reports r
       JOIN users u ON r.user_id = u.id
       WHERE r.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Reporte no encontrado' });

    const report = rows[0];
    if (!canAccessAllReports(req.user.rol) && Number(report.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'No tienes acceso a este reporte' });
    }

    const [excludedRows] = await db.query(
      'SELECT daily_site_log_id FROM report_excluded_logs WHERE report_id = ?',
      [req.params.id]
    );
    const excludedLogIds = excludedRows.map((r) => Number(r.daily_site_log_id));

    const data = await buildReportData(
      Number(report.user_id),
      report.fecha_inicio,
      report.fecha_fin,
      excludedLogIds
    );

    res.json({
      ...report,
      excluded_log_ids: excludedLogIds,
      summary: data.summary,
      included_logs: data.included_logs,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Returns the billing cycle context for a date.
 * Query: ?date=YYYY-MM-DD (optional, defaults to current date).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.getCycle = async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  try {
    const context = await billingCycle.getCycleContextByDate(date);
    if (!context) {
      return res.status(404).json({ message: 'No se encontró semana/periodo para la fecha indicada' });
    }
    res.json(context);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Returns logs for the authenticated user within a period.
 * Query accepts billing_period_id OR fecha_inicio+fecha_fin.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.getPeriodLogs = async (req, res) => {
  const billingPeriodId = req.query.billing_period_id ? Number(req.query.billing_period_id) : null;
  const fechaInicio = req.query.fecha_inicio || null;
  const fechaFin = req.query.fecha_fin || null;

  try {
    const range = await resolveRange(billingPeriodId, fechaInicio, fechaFin);
    if (!range) {
      return res.status(400).json({ message: 'Envía billing_period_id o fecha_inicio + fecha_fin' });
    }

    const [rows] = await db.query(
      `SELECT dsl.id, dsl.user_id, dsl.team_id, dsl.site_id,
              DATE_FORMAT(dsl.fecha, '%Y-%m-%d') AS fecha,
              dsl.horas_trabajadas, dsl.solo_bins, dsl.observaciones, dsl.estado,
              dsl.entry_type, dsl.display_value,
              s.direccion_linea1 AS sitio, c.nombre AS cliente_nombre
       FROM daily_site_logs dsl
       JOIN sites s ON dsl.site_id = s.id
       LEFT JOIN clients c ON s.cliente_id = c.id
       WHERE dsl.user_id = ? AND dsl.fecha BETWEEN ? AND ?
       ORDER BY dsl.fecha, dsl.id`,
      [req.user.id, range.fechaInicio, range.fechaFin]
    );

    res.json({
      billing_period_id: range.billingPeriodId,
      fecha_inicio: range.fechaInicio,
      fecha_fin: range.fechaFin,
      logs: rows,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Returns reports created by the authenticated user.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.getMyReports = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, bp.start_date AS period_start, bp.end_date AS period_end
       FROM reports r
       LEFT JOIN billing_periods bp ON r.billing_period_id = bp.id
       WHERE r.user_id = ?
       ORDER BY r.id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.generate = async (req, res) => {
  const {
    billing_period_id,
    fecha_inicio,
    fecha_fin,
    excluded_log_ids,
    estado,
  } = req.body;

  const excludedLogIds = Array.isArray(excluded_log_ids)
    ? excluded_log_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];

  const finalStatus = estado || 'enviado';
  if (!['borrador', 'enviado', 'aprobado', 'generado'].includes(finalStatus)) {
    return res.status(400).json({ message: 'estado inválido' });
  }

  const conn = await db.getConnection();
  try {
    const range = await resolveRange(
      billing_period_id ? Number(billing_period_id) : null,
      fecha_inicio || null,
      fecha_fin || null
    );
    if (!range) {
      return res.status(400).json({ message: 'Envía billing_period_id o fecha_inicio + fecha_fin válidos' });
    }

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO reports (user_id, fecha_inicio, fecha_fin, billing_period_id, estado)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, range.fechaInicio, range.fechaFin, range.billingPeriodId, finalStatus]
    );

    const reportId = result.insertId;

    let storedExcludedIds = [];
    if (excludedLogIds.length > 0) {
      const [allowedRows] = await conn.query(
        `SELECT id
         FROM daily_site_logs
         WHERE user_id = ? AND fecha BETWEEN ? AND ? AND id IN (?)`,
        [req.user.id, range.fechaInicio, range.fechaFin, excludedLogIds]
      );
      const allowedIds = allowedRows.map((r) => Number(r.id));
      storedExcludedIds = allowedIds;

      for (const logId of allowedIds) {
        await conn.query(
          `INSERT INTO report_excluded_logs (report_id, daily_site_log_id)
           VALUES (?, ?)`,
          [reportId, logId]
        );
      }
    }

    await conn.commit();

    const data = await buildReportData(req.user.id, range.fechaInicio, range.fechaFin, storedExcludedIds);
    res.status(201).json({
      id: reportId,
      user_id: req.user.id,
      billing_period_id: range.billingPeriodId,
      fecha_inicio: range.fechaInicio,
      fecha_fin: range.fechaFin,
      estado: finalStatus,
      excluded_log_ids: storedExcludedIds,
      summary: data.summary,
      included_logs: data.included_logs,
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};

exports.approve = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE reports SET estado = "aprobado" WHERE id = ?',
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Reporte no encontrado' });
    res.json({ message: 'Reporte aprobado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
