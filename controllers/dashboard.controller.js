const db = require('../config/db');
const billingCycle = require('../services/billingCycle.service');

const REPORT_ESTADOS = ['Borrador', 'Enviado', 'Pagado', 'Devuelto', 'Eliminado'];

/**
 * Formats a MySQL DATE / JS Date as YYYY-MM-DD.
 * @param {string|Date} val - Date value from DB or JS.
 * @returns {string}
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
 * Planner day-of-week: Monday=1 … Sunday=7 (matches team_site_cycle_plan_items.day_of_week).
 * @param {string} dateStr - YYYY-MM-DD.
 * @returns {number}
 */
function plannerDayOfWeek(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

/**
 * Rolling 4-week cycle index (1–4) aligned to a fixed Monday anchor.
 * @param {string} dateStr - YYYY-MM-DD.
 * @returns {number}
 */
function plannerCycleWeek(dateStr) {
  const anchor = new Date('2024-01-01T12:00:00');
  const d = new Date(`${dateStr}T12:00:00`);
  const diffDays = Math.floor((d - anchor) / 86400000);
  const weekIndex = Math.floor(diffDays / 7);
  return (weekIndex % 4) + 1;
}

/**
 * Builds a map of report estado → count with all known keys defaulting to 0.
 * @param {Array<{ estado: string, c: number }>} rows - GROUP BY query rows.
 * @returns {Record<string, number>}
 */
function reportsStatusMap(rows) {
  const out = {};
  for (const e of REPORT_ESTADOS) out[e] = 0;
  const byLower = Object.fromEntries(REPORT_ESTADOS.map((e) => [e.toLowerCase(), e]));
  for (const row of rows) {
    if (row.estado == null) continue;
    const key = byLower[String(row.estado).toLowerCase()];
    if (key) out[key] = Number(row.c) || 0;
  }
  return out;
}

/**
 * Maps supply_orders.estado (Spanish enum) to the dashboard admin shape (English keys).
 * @param {Array<{ estado: string, c: number }>} rows - GROUP BY rows.
 * @returns {{ draft: number, pending: number, approved: number, rejected: number, completed: number }}
 */
function mapSupplyOrderStatus(rows) {
  const byEstado = {};
  for (const row of rows) {
    if (row.estado) byEstado[row.estado] = Number(row.c) || 0;
  }
  return {
    draft: 0,
    pending: byEstado.pendiente || 0,
    approved: byEstado.aprobado || 0,
    rejected: byEstado.rechazado || 0,
    completed: byEstado.completado || 0,
  };
}

/**
 * Admin dashboard aggregates (global counts and week hours).
 * @returns {Promise<object>}
 */
async function getAdminStats() {
  const [totRes, orderRes, reportRes, vacRes, complRes, hoursRes] = await Promise.all([
    db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE activo = 1) AS users,
        (SELECT COUNT(*) FROM teams WHERE activo = 1) AS teams,
        (SELECT COUNT(*) FROM sites) AS sites,
        (SELECT COUNT(*) FROM sites WHERE activo = 1) AS active_sites,
        (SELECT COUNT(*) FROM clients) AS clients
    `),
    db.query('SELECT estado, COUNT(*) AS c FROM supply_orders GROUP BY estado'),
    db.query('SELECT estado, COUNT(*) AS c FROM reports GROUP BY estado'),
    db.query(
      'SELECT COUNT(*) AS c FROM vacation_requests WHERE estado = ?',
      ['pendiente']
    ),
    db.query(
      `SELECT COUNT(*) AS c FROM complaints WHERE estado IS NULL OR estado NOT IN ('resuelto')`
    ),
    db.query(
      `SELECT COALESCE(SUM(COALESCE(display_value, horas_trabajadas)), 0) AS h
       FROM daily_site_logs
       WHERE fecha >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
         AND fecha <= DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)`
    ),
  ]);

  const orderRows = orderRes[0];
  const reportRows = reportRes[0];
  const vacPending = vacRes[0];
  const complOpen = complRes[0];
  const hoursRow = hoursRes[0];
  const t = totRes[0][0] || {};
  return {
    totals: {
      users: Number(t.users) || 0,
      teams: Number(t.teams) || 0,
      sites: Number(t.sites) || 0,
      active_sites: Number(t.active_sites) || 0,
      clients: Number(t.clients) || 0,
    },
    orders_by_status: mapSupplyOrderStatus(orderRows),
    reports_by_status: reportsStatusMap(reportRows),
    pending_vacations: Number(vacPending[0]?.c) || 0,
    open_complaints: Number(complOpen[0]?.c) || 0,
    hours_this_week: Number(hoursRow[0]?.h) || 0,
  };
}

/**
 * Manager dashboard scoped to teams in user_team_history (active membership).
 * @param {number} userId - Manager user id.
 * @returns {Promise<object>}
 */
async function getManagerStats(userId) {
  const [teamRows] = await db.query(
    'SELECT team_id FROM user_team_history WHERE user_id = ? AND fecha_fin IS NULL',
    [userId]
  );
  const teamIds = teamRows.map((r) => r.team_id);

  if (teamIds.length === 0) {
    return {
      my_teams_count: 0,
      team_members_count: 0,
      team_sites_count: 0,
      pending_orders: 0,
      logs_this_week: 0,
      hours_this_week: 0,
      pending_vacations: 0,
    };
  }

  const placeholders = teamIds.map(() => '?').join(',');

  const [
    [membersRow],
    [sitesRow],
    [ordersRow],
    [logsRow],
    [hoursRow],
    [vacRow],
  ] = await Promise.all([
    db.query(
      `SELECT COUNT(DISTINCT uth.user_id) AS c
       FROM user_team_history uth
       WHERE uth.team_id IN (${placeholders}) AND uth.fecha_fin IS NULL`,
      teamIds
    ),
    db.query(
      `SELECT COUNT(*) AS c
       FROM team_site_assignments tsa
       WHERE tsa.team_id IN (${placeholders}) AND tsa.activo = 1`,
      teamIds
    ),
    db.query(
      `SELECT COUNT(*) AS c FROM supply_orders WHERE equipo_id IN (${placeholders}) AND estado = 'pendiente'`,
      teamIds
    ),
    db.query(
      `SELECT COUNT(*) AS c
       FROM daily_site_logs dsl
       WHERE dsl.team_id IN (${placeholders})
         AND dsl.fecha >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
         AND dsl.fecha <= DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)`,
      teamIds
    ),
    db.query(
      `SELECT COALESCE(SUM(COALESCE(display_value, horas_trabajadas)), 0) AS h
       FROM daily_site_logs dsl
       WHERE dsl.team_id IN (${placeholders})
         AND dsl.fecha >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
         AND dsl.fecha <= DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)`,
      teamIds
    ),
    db.query(
      `SELECT COUNT(DISTINCT vr.id) AS c
       FROM vacation_requests vr
       INNER JOIN user_team_history uth
         ON uth.user_id = vr.user_id AND uth.fecha_fin IS NULL
       WHERE uth.team_id IN (${placeholders}) AND vr.estado = 'pendiente'`,
      teamIds
    ),
  ]);

  return {
    my_teams_count: teamIds.length,
    team_members_count: Number(membersRow[0]?.c) || 0,
    team_sites_count: Number(sitesRow[0]?.c) || 0,
    pending_orders: Number(ordersRow[0]?.c) || 0,
    logs_this_week: Number(logsRow[0]?.c) || 0,
    hours_this_week: Number(hoursRow[0]?.h) || 0,
    pending_vacations: Number(vacRow[0]?.c) || 0,
  };
}

/**
 * Accountant-focused stats plus hours in the current billing period (from cycle context).
 * @returns {Promise<object>}
 */
async function getAccountantStats() {
  const [reportRes, orderRes, siteRes, siteActiveRes, dateRes] = await Promise.all([
    db.query('SELECT estado, COUNT(*) AS c FROM reports GROUP BY estado'),
    db.query(`SELECT COUNT(*) AS c FROM supply_orders WHERE estado = 'pendiente'`),
    db.query('SELECT COUNT(*) AS c FROM sites'),
    db.query('SELECT COUNT(*) AS c FROM sites WHERE activo = 1'),
    db.query('SELECT CURDATE() AS today'),
  ]);

  const reportRows = reportRes[0];
  const reportsByStatus = reportsStatusMap(reportRows);

  const todayStr = toDateStr(dateRes[0][0].today);
  const context = await billingCycle.getCycleContextByDate(todayStr);
  let hoursThisPeriod = 0;
  if (context && context.billing_period) {
    const start = toDateStr(context.billing_period.start_date);
    const end = toDateStr(context.billing_period.end_date);
    const [hRows] = await db.query(
      `SELECT COALESCE(SUM(COALESCE(display_value, horas_trabajadas)), 0) AS h
       FROM daily_site_logs
       WHERE fecha BETWEEN ? AND ?`,
      [start, end]
    );
    hoursThisPeriod = Number(hRows[0]?.h) || 0;
  }

  return {
    reports_by_status: reportsByStatus,
    reports_enviado_count: reportsByStatus.Enviado || 0,
    reports_pagado_count: reportsByStatus.Pagado || 0,
    orders_pending_count: Number(orderRes[0][0]?.c) || 0,
    total_sites: Number(siteRes[0][0]?.c) || 0,
    active_sites: Number(siteActiveRes[0][0]?.c) || 0,
    hours_this_period: hoursThisPeriod,
  };
}

/**
 * Cleaner dashboard: today's planner slice, week logs, team orders, vacation hints.
 * @param {number} userId - Cleaner user id.
 * @returns {Promise<object>}
 */
async function getCleanerStats(userId) {
  const [teamRows] = await db.query(
    'SELECT team_id FROM user_team_history WHERE user_id = ? AND fecha_fin IS NULL LIMIT 1',
    [userId]
  );
  const teamId = teamRows.length ? teamRows[0].team_id : null;

  const [dateRows] = await db.query('SELECT CURDATE() AS today');
  const todayStr = toDateStr(dateRows[0].today);
  const cycleWeek = plannerCycleWeek(todayStr);
  const dow = plannerDayOfWeek(todayStr);

  let sitesToday = [];
  if (teamId) {
    const [siteRows] = await db.query(
      `SELECT s.id AS site_id,
              TRIM(CONCAT(
                COALESCE(NULLIF(s.direccion_linea1, ''), ''),
                IF(s.suburb IS NOT NULL AND TRIM(s.suburb) <> '', CONCAT(', ', s.suburb), '')
              )) AS nombre,
              SUM(COALESCE(i.display_value, 0)) AS horas
       FROM team_site_cycle_plan p
       INNER JOIN team_site_cycle_plan_items i ON i.plan_id = p.id
       INNER JOIN sites s ON s.id = p.site_id
       WHERE p.team_id = ?
         AND p.cycle_week = ?
         AND i.day_of_week = ?
         AND (p.active = 1 OR p.active IS NULL)
       GROUP BY s.id, s.direccion_linea1, s.suburb
       ORDER BY s.id`,
      [teamId, cycleWeek, dow]
    );
    sitesToday = siteRows.map((row) => ({
      site_id: Number(row.site_id),
      nombre: row.nombre || `Sitio ${row.site_id}`,
      horas: Number(row.horas) || 0,
    }));
  }

  const [logsRes, hoursRes, pendRes, vacPRes, vacNRes] = await Promise.all([
    teamId
      ? db.query(
          `SELECT COUNT(*) AS c
           FROM daily_site_logs
           WHERE user_id = ?
             AND fecha >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
             AND fecha <= DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)`,
          [userId]
        )
      : Promise.resolve([[{ c: 0 }], []]),
    db.query(
      `SELECT COALESCE(SUM(COALESCE(display_value, horas_trabajadas)), 0) AS h
       FROM daily_site_logs
       WHERE user_id = ?
         AND fecha >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
         AND fecha <= DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)`,
      [userId]
    ),
    teamId
      ? db.query(
          `SELECT COUNT(*) AS c FROM supply_orders WHERE equipo_id = ? AND estado = 'pendiente'`,
          [teamId]
        )
      : Promise.resolve([[{ c: 0 }], []]),
    db.query(
      'SELECT EXISTS(SELECT 1 FROM vacation_requests WHERE user_id = ? AND estado = ?) AS e',
      [userId, 'pendiente']
    ),
    db.query(
      `SELECT MIN(fecha_inicio) AS d
       FROM vacation_requests
       WHERE user_id = ? AND estado = 'aprobado' AND fecha_inicio >= CURDATE()`,
      [userId]
    ),
  ]);

  const vacNext = vacNRes[0];
  const nextStart = vacNext[0]?.d ? toDateStr(vacNext[0].d) : null;

  return {
    sites_today: sitesToday,
    sites_today_count: sitesToday.length,
    logs_this_week: Number(logsRes[0][0]?.c) || 0,
    hours_this_week: Number(hoursRes[0][0]?.h) || 0,
    pending_orders: Number(pendRes[0][0]?.c) || 0,
    vacation_status: {
      has_pending: Boolean(vacPRes[0][0]?.e),
      next_approved_start: nextStart,
    },
  };
}

/**
 * GET /api/dashboard/stats — KPIs for the authenticated user’s role.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.getStats = async (req, res) => {
  const { rol, id } = req.user;
  const generatedAt = new Date().toISOString();

  try {
    let stats;
    switch (rol) {
      case 'admin':
        stats = await getAdminStats();
        break;
      case 'manager':
        stats = await getManagerStats(id);
        break;
      case 'accountant':
        stats = await getAccountantStats();
        break;
      case 'cleaner':
        stats = await getCleanerStats(id);
        break;
      default:
        return res.status(403).json({ message: 'Rol no soportado para estadísticas' });
    }

    res.json({
      rol,
      generated_at: generatedAt,
      stats,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
