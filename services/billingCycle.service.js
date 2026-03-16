const db = require('../config/db');

/**
 * Returns the billing week that contains the provided date.
 * @param {string} dateStr - Date in YYYY-MM-DD format.
 * @returns {Promise<object|null>} Billing week row or null.
 */
async function getWeekByDate(dateStr) {
  const [rows] = await db.query(
    `SELECT bw.id, bw.start_date, bw.end_date, bw.period_id
     FROM billing_weeks bw
     WHERE ? BETWEEN bw.start_date AND bw.end_date
     LIMIT 1`,
    [dateStr]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Returns billing period details for a period id.
 * @param {number} periodId - billing_periods.id.
 * @returns {Promise<object|null>} Billing period row or null.
 */
async function getPeriodById(periodId) {
  const [rows] = await db.query(
    `SELECT bp.id, bp.start_date, bp.end_date
     FROM billing_periods bp
     WHERE bp.id = ?
     LIMIT 1`,
    [periodId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Returns weeks that belong to a billing period.
 * @param {number} periodId - billing_periods.id.
 * @returns {Promise<Array>} List of period weeks ordered by start date.
 */
async function getWeeksByPeriodId(periodId) {
  const [rows] = await db.query(
    `SELECT bw.id, bw.start_date, bw.end_date
     FROM billing_weeks bw
     WHERE bw.period_id = ?
     ORDER BY bw.start_date`,
    [periodId]
  );
  return rows;
}

/**
 * Resolves billing context for a given date.
 * @param {string} dateStr - Date in YYYY-MM-DD format.
 * @returns {Promise<object|null>} Context with week and period data.
 */
async function getCycleContextByDate(dateStr) {
  const week = await getWeekByDate(dateStr);
  if (!week || !week.period_id) return null;

  const period = await getPeriodById(week.period_id);
  if (!period) return null;

  const weeks = await getWeeksByPeriodId(period.id);
  const currentWeekIndex = weeks.findIndex((w) => Number(w.id) === Number(week.id));

  return {
    date: dateStr,
    billing_week: week,
    billing_period: period,
    period_weeks: weeks,
    is_report_week: currentWeekIndex === weeks.length - 1,
  };
}

module.exports = {
  getWeekByDate,
  getPeriodById,
  getWeeksByPeriodId,
  getCycleContextByDate,
};
