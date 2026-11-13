/**
 * Log sharing between cleaners.
 *
 * Flow: the sender offers their logs of a date range -> the logs are STAGED (copied into log_share_items at that
 * moment) -> the recipient previews them -> accepting creates exactly those logs for the recipient.
 *
 * Rules when creating the recipient's logs:
 * - Only missing logs are created: if the recipient already has a log with the same site, date and entry type,
 *   it is skipped, never overwritten (confirmed or not).
 * - Each copy keeps the original team_id, so it works for recipients of another team or without a team
 *   (daily_site_logs.team_id is NOT NULL).
 * - Copies start as 'pendiente' so the recipient reviews them like any other log.
 */

const LOG_COLUMNS = 'team_id, site_id, horas_trabajadas, solo_bins, observaciones, billing_week_id, entry_type, display_value';

/**
 * Creates, for the target, the rows that it does not have yet.
 * @param {object} conn - DB connection (call inside a transaction).
 * @param {Array<object>} rows - Logs to copy (site_id, fecha 'YYYY-MM-DD', entry_type, team_id, values...).
 * @param {number} targetUserId - Recipient.
 * @returns {Promise<{source_total:number, created:number, skipped_existing:number}>}
 */
async function insertMissing(conn, rows, targetUserId) {
  let created = 0;
  let skippedExisting = 0;

  for (const log of rows) {
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
        targetUserId, log.team_id, log.site_id, log.fecha, log.horas_trabajadas, log.solo_bins,
        log.observaciones, log.billing_week_id, log.entry_type, log.display_value,
      ]
    );
    created += 1;
  }

  return { source_total: rows.length, created, skipped_existing: skippedExisting };
}

const SELECT_SOURCE_LOGS = `
  SELECT id, ${LOG_COLUMNS}, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha
  FROM daily_site_logs
  WHERE user_id = ? AND fecha BETWEEN ? AND ?
  ORDER BY fecha, id`;

/**
 * LEGACY: copies the sender's logs of the range as they are right now. Only used for requests created before
 * logs were staged (they have no rows in log_share_items).
 */
async function copyLogs(conn, { sourceUserId, targetUserId, fechaInicio, fechaFin }) {
  const [rows] = await conn.query(SELECT_SOURCE_LOGS, [sourceUserId, fechaInicio, fechaFin]);
  return insertMissing(conn, rows, targetUserId);
}

/**
 * Stages the sender's logs of the range for a share: a frozen copy of what is being offered.
 * @returns {Promise<number>} How many logs were staged.
 */
async function stageLogs(conn, { shareId, senderId, fechaInicio, fechaFin }) {
  const [result] = await conn.query(
    `INSERT INTO log_share_items (share_id, source_log_id, ${LOG_COLUMNS}, fecha)
     SELECT ?, id, ${LOG_COLUMNS}, fecha
     FROM daily_site_logs
     WHERE user_id = ? AND fecha BETWEEN ? AND ?
     ORDER BY fecha, id`,
    [shareId, senderId, fechaInicio, fechaFin]
  );
  return result.affectedRows;
}

const SELECT_STAGED = `
  SELECT id, ${LOG_COLUMNS}, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha
  FROM log_share_items
  WHERE share_id = ?
  ORDER BY fecha, id`;

/** @returns {Promise<Array<object>>} The staged logs of a share (empty for requests created before staging). */
async function getStagedLogs(conn, shareId) {
  const [rows] = await conn.query(SELECT_STAGED, [shareId]);
  return rows;
}

/**
 * Creates for the recipient exactly the logs that were staged (what the sender offered), or, for requests
 * created before staging existed, the sender's current logs of the range.
 * @param {object} share - { id, sender_id, fecha_inicio, fecha_fin } ('YYYY-MM-DD' strings).
 */
async function acceptShare(conn, share, targetUserId) {
  const staged = await getStagedLogs(conn, share.id);
  if (staged.length > 0) return insertMissing(conn, staged, targetUserId);
  return copyLogs(conn, {
    sourceUserId: share.sender_id,
    targetUserId,
    fechaInicio: share.fecha_inicio,
    fechaFin: share.fecha_fin,
  });
}

/**
 * What accepting would do, log by log, for the recipient: each offered log is either 'create' or 'skip'
 * (the recipient already has that site/day/type; their own log is returned so the difference is visible).
 * @param {object} conn - DB connection or pool.
 * @param {object} share - { id, sender_id, fecha_inicio, fecha_fin }.
 * @param {number} recipientId
 */
async function previewShare(conn, share, recipientId) {
  let rows = await getStagedLogs(conn, share.id);
  const staged = rows.length > 0;
  if (!staged) {
    [rows] = await conn.query(SELECT_SOURCE_LOGS, [share.sender_id, share.fecha_inicio, share.fecha_fin]);
  }

  const items = [];
  for (const log of rows) {
    const [[site]] = await conn.query('SELECT direccion_linea1, suburb FROM sites WHERE id = ?', [log.site_id]);
    const [existing] = await conn.query(
      `SELECT display_value, observaciones, estado
       FROM daily_site_logs
       WHERE user_id = ? AND site_id = ? AND fecha = ? AND (entry_type <=> ?)
       LIMIT 1`,
      [recipientId, log.site_id, log.fecha, log.entry_type]
    );
    items.push({
      fecha: log.fecha,
      site_id: log.site_id,
      sitio: site?.direccion_linea1 || `Sitio ${log.site_id}`,
      suburb: site?.suburb || null,
      entry_type: log.entry_type,
      display_value: log.display_value === null ? null : Number(log.display_value),
      observaciones: log.observaciones,
      action: existing.length > 0 ? 'skip' : 'create',
      existing: existing.length > 0
        ? {
          display_value: existing[0].display_value === null ? null : Number(existing[0].display_value),
          observaciones: existing[0].observaciones,
          estado: existing[0].estado,
        }
        : null,
    });
  }

  const createCount = items.filter((i) => i.action === 'create').length;
  return {
    staged,
    summary: { total: items.length, create_count: createCount, skip_count: items.length - createCount },
    items,
  };
}

module.exports = { copyLogs, stageLogs, getStagedLogs, acceptShare, previewShare };
