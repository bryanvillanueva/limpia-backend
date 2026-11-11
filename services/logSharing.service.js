/**
 * Copies one user's logs for a date range into another user's logs.
 *
 * - Only creates missing logs: a log the target already has (same site, date and entry type)
 *   is skipped, never overwritten.
 * - Each copied log keeps the source log's team_id, so it works for targets that belong to
 *   another team or to no team at all (daily_site_logs.team_id is NOT NULL).
 * - Copied logs start as 'pendiente' so the target reviews them like any other log.
 *
 * @param {object} conn - DB connection (call inside a transaction).
 * @param {object} options
 * @param {number} options.sourceUserId - User whose logs are copied.
 * @param {number} options.targetUserId - User who receives the copies.
 * @param {string} options.fechaInicio - Range start (YYYY-MM-DD).
 * @param {string} options.fechaFin - Range end (YYYY-MM-DD).
 * @returns {Promise<{source_total:number, created:number, skipped_existing:number}>}
 */
async function copyLogs(conn, { sourceUserId, targetUserId, fechaInicio, fechaFin }) {
  const [sourceLogs] = await conn.query(
    `SELECT id, team_id, site_id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
            horas_trabajadas, solo_bins, observaciones, billing_week_id, entry_type, display_value
     FROM daily_site_logs
     WHERE user_id = ? AND fecha BETWEEN ? AND ?
     ORDER BY fecha, id`,
    [sourceUserId, fechaInicio, fechaFin]
  );

  let created = 0;
  let skippedExisting = 0;

  for (const log of sourceLogs) {
    const [existing] = await conn.query(
      `SELECT id
       FROM daily_site_logs
       WHERE user_id = ? AND site_id = ? AND fecha = ? AND (entry_type <=> ?)
       LIMIT 1`,
      [targetUserId, log.site_id, log.fecha, log.entry_type]
    );

    if (existing.length > 0) {
      skippedExisting += 1;
      continue;
    }

    await conn.query(
      `INSERT INTO daily_site_logs
       (user_id, team_id, site_id, fecha, horas_trabajadas, solo_bins, observaciones,
        estado, billing_week_id, entry_type, display_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
      [
        targetUserId,
        log.team_id,
        log.site_id,
        log.fecha,
        log.horas_trabajadas,
        log.solo_bins,
        log.observaciones,
        log.billing_week_id,
        log.entry_type,
        log.display_value,
      ]
    );
    created += 1;
  }

  return { source_total: sourceLogs.length, created, skipped_existing: skippedExisting };
}

module.exports = { copyLogs };
