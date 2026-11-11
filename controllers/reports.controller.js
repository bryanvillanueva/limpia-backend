const db = require('../config/db');
const billingCycle = require('../services/billingCycle.service');
const XLSX = require('xlsx');

/**
 * Normalizes a value (Date object or string) to YYYY-MM-DD string.
 * Uses local date parts to avoid timezone shifts from toISOString().
 */
function toDateStr(val) {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

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
 * Builds report summary and detail from logs in the period.
 * @param {number} userId - Owner user id.
 * @param {string} fechaInicio - Start date.
 * @param {string} fechaFin - End date.
 * @returns {Promise<{summary: object, included_logs: Array}>}
 */
async function buildReportData(userId, fechaInicio, fechaFin) {
  const detailQuery = `
    SELECT dsl.id, dsl.user_id, dsl.team_id, dsl.site_id,
           DATE_FORMAT(dsl.fecha, '%Y-%m-%d') AS fecha,
           dsl.horas_trabajadas, dsl.solo_bins, dsl.observaciones, dsl.estado,
           dsl.entry_type, dsl.display_value,
           s.direccion_linea1 AS sitio, s.suburb, c.nombre AS cliente_nombre,
           t.numero AS team_numero,
           tsa.frecuencia
    FROM daily_site_logs dsl
    JOIN sites s ON dsl.site_id = s.id
    LEFT JOIN clients c ON s.cliente_id = c.id
    LEFT JOIN teams t ON dsl.team_id = t.id
    LEFT JOIN team_site_assignments tsa
           ON tsa.team_id = dsl.team_id
          AND tsa.site_id = dsl.site_id
          AND tsa.activo = 1
    WHERE dsl.user_id = ? AND dsl.fecha BETWEEN ? AND ?
    ORDER BY dsl.id
  `;
  const [includedLogs] = await db.query(detailQuery, [userId, fechaInicio, fechaFin]);

  const summaryQuery = `
    SELECT dsl.user_id,
           u.nombre,
           u.apellido,
           COUNT(*) AS total_logs,
           SUM(CASE WHEN dsl.entry_type = 'BINS' OR dsl.solo_bins = 1 THEN 1 ELSE 0 END) AS total_bins_entries,
           SUM(COALESCE(dsl.display_value, dsl.horas_trabajadas, 0)) AS total_valor
    FROM daily_site_logs dsl
    JOIN users u ON dsl.user_id = u.id
    WHERE dsl.user_id = ? AND dsl.fecha BETWEEN ? AND ?
    GROUP BY dsl.user_id, u.nombre, u.apellido
  `;
  const [summaryRows] = await db.query(summaryQuery, [userId, fechaInicio, fechaFin]);
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

/**
 * Builds a grid view of included logs grouped by site × date.
 * Each row represents a site; columns are the 14 days of the period.
 * Also computes per-site totals, per-day totals, and a grand total.
 *
 * @param {Array} includedLogs - Logs returned by buildReportData.
 * @param {string} fechaInicio - Period start (YYYY-MM-DD).
 * @param {string} fechaFin - Period end (YYYY-MM-DD).
 * @returns {{ dates: string[], week1_dates: string[], week2_dates: string[], sites: Array, day_totals: object, grand_total: number }}
 */
function buildReportGrid(includedLogs, fechaInicio, fechaFin) {
  // Generate all dates in the period
  const dates = [];
  const d = new Date(fechaInicio + 'T00:00:00');
  const end = new Date(fechaFin + 'T00:00:00');
  while (d <= end) {
    dates.push(toDateStr(d));
    d.setDate(d.getDate() + 1);
  }

  const week1_dates = dates.slice(0, 7);
  const week2_dates = dates.slice(7, 14);

  // Group logs by site_id
  const siteMap = {};
  for (const log of includedLogs) {
    const key = log.site_id;
    if (!siteMap[key]) {
      siteMap[key] = {
        site_id: log.site_id,
        sitio: log.sitio,
        suburb: log.suburb,
        cliente_nombre: log.cliente_nombre,
        team_numero: log.team_numero,
        frecuencia: log.frecuencia,
        days: {},
        comments: [],
        site_total: 0,
      };
    }
    const site = siteMap[key];
    const valor = Number(log.display_value || log.horas_trabajadas || 0);
    const entryType = log.entry_type || (log.solo_bins ? 'BINS' : 'SERVICE');

    // Accumulate value for the date (multiple entry types possible per site per day)
    if (!site.days[log.fecha]) {
      site.days[log.fecha] = { total: 0, entries: [] };
    }
    site.days[log.fecha].total += valor;
    site.days[log.fecha].entries.push({
      log_id: log.id,
      entry_type: entryType,
      display_value: valor,
      observaciones: log.observaciones,
    });
    site.site_total += valor;

    if (log.observaciones && log.observaciones.trim()) {
      site.comments.push({
        fecha: log.fecha,
        entry_type: entryType,
        observaciones: log.observaciones,
      });
    }
  }

  const sites = Object.values(siteMap);
  sites.sort((a, b) => {
    const aFirstLog = Math.min(...Object.values(a.days).flatMap(d => d.entries.map(e => e.log_id)));
    const bFirstLog = Math.min(...Object.values(b.days).flatMap(d => d.entries.map(e => e.log_id)));
    return aFirstLog - bFirstLog;
  });

  // Day totals across all sites
  const day_totals = {};
  let grand_total = 0;
  for (const date of dates) {
    let daySum = 0;
    for (const site of sites) {
      daySum += site.days[date] ? site.days[date].total : 0;
    }
    day_totals[date] = daySum;
    grand_total += daySum;
  }

  return { dates, week1_dates, week2_dates, sites, day_totals, grand_total };
}

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, u.nombre AS generado_por, u.apellido AS generado_por_apellido,
              t.numero AS team_numero,
              bp.start_date AS period_start, bp.end_date AS period_end
       FROM reports r
       JOIN users u ON r.user_id = u.id
       LEFT JOIN user_team_history uth ON uth.user_id = r.user_id AND uth.fecha_fin IS NULL
       LEFT JOIN teams t ON t.id = uth.team_id
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

    const fechaInicio = toDateStr(report.fecha_inicio);
    const fechaFin = toDateStr(report.fecha_fin);

    const data = await buildReportData(Number(report.user_id), fechaInicio, fechaFin);
    const grid = buildReportGrid(data.included_logs, fechaInicio, fechaFin);

    res.json({
      ...report,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      summary: data.summary,
      included_logs: data.included_logs,
      grid,
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
  const { billing_period_id, fecha_inicio, fecha_fin, estado } = req.body;

  const finalStatus = estado || 'Enviado';
  if (!['Borrador', 'Enviado', 'Pagado', 'Devuelto', 'Eliminado'].includes(finalStatus)) {
    return res.status(400).json({ message: 'estado inválido' });
  }

  try {
    const range = await resolveRange(
      billing_period_id ? Number(billing_period_id) : null,
      fecha_inicio || null,
      fecha_fin || null
    );
    if (!range) {
      return res.status(400).json({ message: 'Envía billing_period_id o fecha_inicio + fecha_fin válidos' });
    }

    const [result] = await db.query(
      `INSERT INTO reports (user_id, fecha_inicio, fecha_fin, billing_period_id, estado)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, range.fechaInicio, range.fechaFin, range.billingPeriodId, finalStatus]
    );

    const reportId = result.insertId;

    const data = await buildReportData(req.user.id, range.fechaInicio, range.fechaFin);
    const grid = buildReportGrid(data.included_logs, range.fechaInicio, range.fechaFin);
    res.status(201).json({
      id: reportId,
      user_id: req.user.id,
      billing_period_id: range.billingPeriodId,
      fecha_inicio: range.fechaInicio,
      fecha_fin: range.fechaFin,
      estado: finalStatus,
      summary: data.summary,
      included_logs: data.included_logs,
      grid,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * GET /api/reports/:id/export-excel
 * Generates and downloads an Excel file for the report.
 * Format: grid with sites as rows, dates as columns, totals row/column, comments section.
 */
exports.exportExcel = async (req, res) => {
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

    const fechaInicio = toDateStr(report.fecha_inicio);
    const fechaFin = toDateStr(report.fecha_fin);

    const data = await buildReportData(Number(report.user_id), fechaInicio, fechaFin);
    const grid = buildReportGrid(data.included_logs, fechaInicio, fechaFin);

    // Build Excel workbook
    const wb = XLSX.utils.book_new();
    const wsData = [];

    const teamNumero = grid.sites.length > 0 ? grid.sites[0].team_numero : '';
    const userName = `${report.generado_por} ${report.generado_por_apellido || ''}`.trim();

    const fmtDMY = (d) => {
      const dt = new Date(d + 'T00:00:00');
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      return `${dd}/${mm}/${dt.getFullYear()}`;
    };

    // Helper: build site rows for one week (no header, no totals)
    const buildWeekSiteRows = (weekDates, weekNumber) => {
      const rows = [];
      const mondayDate = fmtDMY(weekDates[0]);

      for (const site of grid.sites) {
        const hasData = weekDates.some(d => site.days[d]);
        if (!hasData) continue;

        const siteLabel = [site.sitio, site.suburb].filter(Boolean).join(', ');
        const comments = site.comments
          .filter(c => weekDates.includes(c.fecha))
          .map(c => c.observaciones)
          .join('; ');

        let rowTotal = 0;
        const row = [teamNumero, weekNumber, mondayDate, userName, siteLabel, site.frecuencia || ''];
        for (const d of weekDates) {
          const val = site.days[d] ? site.days[d].total : 0;
          row.push(val || '');
          rowTotal += val;
        }
        row.push(comments, rowTotal || '');
        rows.push(row);
      }

      return rows;
    };

    // Header (only once)
    wsData.push([
      'Equipo #', 'Semana #', 'Semana empezando Lunes',
      'Nombre', 'Sitio', 'Frecuencia',
      'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo',
      'Comentarios', 'Total Horas',
    ]);

    // Week 1 rows
    for (const row of buildWeekSiteRows(grid.week1_dates, 1)) wsData.push(row);

    // Blank separator
    wsData.push([]);

    // Week 2 rows
    for (const row of buildWeekSiteRows(grid.week2_dates, 2)) wsData.push(row);

    // Grand total row (sum of both weeks)
    const grandTotalRow = ['', '', '', '', 'TOTAL', ''];
    for (let i = 0; i < 7; i++) grandTotalRow.push(''); // empty day columns
    grandTotalRow.push('', grid.grand_total || '');
    wsData.push(grandTotalRow);

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Center-align hours columns (cols 6-12) and Total Horas (col 14)
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = 6; c <= 12; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]) ws[addr].s = { alignment: { horizontal: 'center' } };
      }
      const totalAddr = XLSX.utils.encode_cell({ r, c: 14 });
      if (ws[totalAddr]) ws[totalAddr].s = { alignment: { horizontal: 'center' } };
    }

    // Column widths
    ws['!cols'] = [
      { wch: 10 }, // Equipo #
      { wch: 10 }, // Semana #
      { wch: 24 }, // Semana empezando Lunes
      { wch: 22 }, // Nombre
      { wch: 35 }, // Sitio
      { wch: 18 }, // Frecuencia
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, // 7 days
      { wch: 30 }, // Comentarios
      { wch: 12 }, // Total Horas
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Time Sheet');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // File name
    const teamName = teamNumero || 'Team';
    const fmtDM = (d) => {
      const dt = new Date(d + 'T00:00:00');
      return `${String(dt.getDate()).padStart(2, '0')} ${String(dt.getMonth() + 1).padStart(2, '0')}`;
    };
    const year = new Date(fechaFin + 'T00:00:00').getFullYear();
    const fileName = `Time Sheet - ${teamName} - (${userName}) semana del ${fmtDM(fechaInicio)} al ${fmtDM(fechaFin)} del ${year}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  const { estado, invoice_reference_number } = req.body;
  if (!estado || !['Borrador', 'Enviado', 'Pagado', 'Devuelto', 'Eliminado'].includes(estado)) {
    return res.status(400).json({ message: 'estado inválido' });
  }
  if (estado === 'Pagado' && !invoice_reference_number) {
    return res.status(400).json({ message: 'invoice_reference_number es requerido para marcar como Pagado' });
  }
  try {
    const invoiceRef = estado === 'Pagado' ? invoice_reference_number : null;
    const [result] = await db.query(
      'UPDATE reports SET estado = ?, invoice_reference_number = ? WHERE id = ?',
      [estado, invoiceRef, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Reporte no encontrado' });
    res.json({ message: `Reporte actualizado a ${estado}` });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
