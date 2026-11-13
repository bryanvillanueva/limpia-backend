const db = require('../config/db');
const { createNotification } = require('../services/notifications.service');
const { stageLogs, acceptShare, previewShare } = require('../services/logSharing.service');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Formats 'YYYY-MM-DD' as '9 nov'.
 * @param {string} str - Date string.
 * @returns {string}
 */
function fmtShort(str) {
  const [, m, d] = str.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * Pluralizes "log" in Spanish.
 * @param {number} n - Count.
 * @returns {string}
 */
function logsLabel(n) {
  return `${n} log${n !== 1 ? 's' : ''}`;
}

/**
 * Loads display info for a user.
 * @param {object} executor - DB pool or connection.
 * @param {number} userId - User id.
 * @returns {Promise<{id:number, nombre:string, apellido:string}|null>}
 */
async function getUserName(executor, userId) {
  const [rows] = await executor.query('SELECT id, nombre, apellido FROM users WHERE id = ?', [userId]);
  return rows[0] || null;
}

/**
 * @param {{nombre:string, apellido:string}} u - User row.
 * @returns {string} Full display name.
 */
function fullName(u) {
  return `${u.nombre || ''} ${u.apellido || ''}`.trim();
}

/**
 * Active teammates of a user (same current team), excluding the user.
 * @param {number} userId - User id.
 * @returns {Promise<Array<{id:number, nombre:string, apellido:string}>>}
 */
async function getTeammates(userId) {
  const [rows] = await db.query(
    `SELECT u.id, u.nombre, u.apellido
     FROM user_team_history me
     JOIN user_team_history uth ON uth.team_id = me.team_id AND uth.fecha_fin IS NULL
     JOIN users u ON u.id = uth.user_id
     WHERE me.user_id = ? AND me.fecha_fin IS NULL
       AND uth.user_id <> ? AND u.activo = 1 AND u.rol = 'cleaner'
     ORDER BY u.nombre, u.apellido`,
    [userId, userId]
  );
  return rows.map((r) => ({ id: Number(r.id), nombre: r.nombre, apellido: r.apellido }));
}

/**
 * GET /log-shares/recipients
 * Teammates the user can share logs with directly (people outside the team are reached by email).
 */
exports.getRecipients = async (req, res) => {
  try {
    return res.json({ teammates: await getTeammates(req.user.id) });
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * POST /log-shares
 * Offers the sender's logs for a date range to another cleaner and notifies them.
 * The logs are STAGED at this moment (frozen copy), so the recipient receives exactly what was offered:
 * logs the sender adds, edits or deletes afterwards do not change the request.
 * Nothing is created for the recipient until they accept.
 * Body: { fecha_inicio, fecha_fin, recipient_id } for a teammate, or { fecha_inicio, fecha_fin, recipient_email }
 * for anyone else (another team or no team).
 */
exports.create = async (req, res) => {
  const { fecha_inicio: fechaInicio, fecha_fin: fechaFin } = req.body;
  const recipientId = req.body.recipient_id ? Number(req.body.recipient_id) : null;
  const recipientEmail = typeof req.body.recipient_email === 'string' ? req.body.recipient_email.trim() : '';

  if (!DATE_RE.test(fechaInicio || '') || !DATE_RE.test(fechaFin || '') || fechaInicio > fechaFin) {
    return res.status(400).json({ message: 'fecha_inicio y fecha_fin deben ser fechas válidas (YYYY-MM-DD)' });
  }
  if (!recipientId && !recipientEmail) {
    return res.status(400).json({ message: 'Indica un compañero (recipient_id) o un email (recipient_email)' });
  }

  const conn = await db.getConnection();
  try {
    // 1. Resolve the recipient
    let recipient = null;
    if (recipientId) {
      const teammates = await getTeammates(req.user.id);
      recipient = teammates.find((t) => t.id === recipientId) || null;
      if (!recipient) {
        return res.status(403).json({ message: 'Ese usuario no es parte de tu equipo' });
      }
    } else {
      const [rows] = await conn.query(
        `SELECT id, nombre, apellido FROM users
         WHERE LOWER(email) = LOWER(?) AND activo = 1 AND rol = 'cleaner'
         LIMIT 1`,
        [recipientEmail]
      );
      if (rows.length === 0) {
        return res.status(404).json({ message: 'No encontramos un limpiador activo con ese email' });
      }
      recipient = { id: Number(rows[0].id), nombre: rows[0].nombre, apellido: rows[0].apellido };
    }
    if (recipient.id === req.user.id) {
      return res.status(400).json({ message: 'No puedes compartir logs contigo mismo' });
    }

    // 2. The sender must have something to share
    const [[{ total }]] = await conn.query(
      'SELECT COUNT(*) AS total FROM daily_site_logs WHERE user_id = ? AND fecha BETWEEN ? AND ?',
      [req.user.id, fechaInicio, fechaFin]
    );
    if (Number(total) === 0) {
      return res.status(400).json({ message: 'Necesitas al menos un log registrado en ese periodo para compartir' });
    }

    // 3. Avoid sending the same request twice while one is still waiting
    const [dup] = await conn.query(
      `SELECT id FROM log_shares
       WHERE sender_id = ? AND recipient_id = ? AND fecha_inicio = ? AND fecha_fin = ? AND status = 'pending'
       LIMIT 1`,
      [req.user.id, recipient.id, fechaInicio, fechaFin]
    );
    if (dup.length > 0) {
      return res.status(409).json({ message: `Ya enviaste esta solicitud a ${fullName(recipient)} y está pendiente` });
    }

    // 4. Create the request and notify the recipient
    const sender = await getUserName(conn, req.user.id);
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO log_shares (sender_id, recipient_id, fecha_inicio, fecha_fin, logs_count)
       VALUES (?, ?, ?, ?, 0)`,
      [req.user.id, recipient.id, fechaInicio, fechaFin]
    );
    // Freeze what is being offered; this number is the exact amount the recipient will be offered
    const staged = await stageLogs(conn, { shareId: result.insertId, senderId: req.user.id, fechaInicio, fechaFin });
    if (staged === 0) {
      await conn.rollback();
      return res.status(400).json({ message: 'Necesitas al menos un log registrado en ese periodo para compartir' });
    }
    await conn.query('UPDATE log_shares SET logs_count = ? WHERE id = ?', [staged, result.insertId]);
    await createNotification(conn, {
      userId: recipient.id,
      type: 'log_share_request',
      title: `${fullName(sender)} quiere compartirte sus logs`,
      message: `${fmtShort(fechaInicio)} – ${fmtShort(fechaFin)} · ${logsLabel(staged)}. Revísalos y decide si quieres recibirlos.`,
      refId: result.insertId,
      data: { sender_id: sender.id, fecha_inicio: fechaInicio, fecha_fin: fechaFin, logs_count: staged },
    });
    await conn.commit();

    return res.status(201).json({
      id: result.insertId,
      status: 'pending',
      recipient: { id: recipient.id, nombre: recipient.nombre, apellido: recipient.apellido },
      logs_count: staged,
    });
  } catch (err) {
    try { await conn.rollback(); } catch { /* no open transaction */ }
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};

/**
 * Loads a pending share inside a transaction, locking the row so two taps cannot both process it.
 * @param {object} conn - DB connection with an open transaction.
 * @param {number|string} shareId - log_shares.id.
 * @param {'recipient_id'|'sender_id'} ownerColumn - Which side must be the authenticated user.
 * @param {number} userId - Authenticated user id.
 * @returns {Promise<{share?:object, error?:{status:number, message:string}}>}
 */
async function loadPendingShare(conn, shareId, ownerColumn, userId) {
  const [rows] = await conn.query(
    `SELECT id, sender_id, recipient_id, status,
            DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
            DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin
     FROM log_shares WHERE id = ? FOR UPDATE`,
    [shareId]
  );
  const share = rows[0];
  if (!share || Number(share[ownerColumn]) !== Number(userId)) {
    return { error: { status: 404, message: 'Solicitud no encontrada' } };
  }
  if (share.status !== 'pending') {
    return { error: { status: 409, message: 'Esta solicitud ya fue respondida o cancelada' } };
  }
  return { share };
}

/**
 * Marks the recipient's notification(s) for a share as read.
 * @param {object} conn - DB connection.
 * @param {number} shareId - log_shares.id.
 */
async function markRequestNotificationRead(conn, shareId) {
  await conn.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
     WHERE type = 'log_share_request' AND ref_id = ?`,
    [shareId]
  );
}

/**
 * GET /log-shares/:id/preview  (recipient)
 * What accepting would do, log by log: which offered logs would be created and which the recipient already has
 * (with their own value, so differences are visible). Reads only; nothing is created.
 */
exports.preview = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ls.id, ls.sender_id, ls.recipient_id, ls.status,
              DATE_FORMAT(ls.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
              DATE_FORMAT(ls.fecha_fin, '%Y-%m-%d') AS fecha_fin,
              u.nombre AS sender_nombre, u.apellido AS sender_apellido
       FROM log_shares ls
       JOIN users u ON u.id = ls.sender_id
       WHERE ls.id = ?`,
      [req.params.id]
    );
    const share = rows[0];
    if (!share || Number(share.recipient_id) !== Number(req.user.id)) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    const preview = await previewShare(db, share, req.user.id);
    return res.json({
      id: Number(share.id),
      status: share.status,
      sender: { id: Number(share.sender_id), nombre: share.sender_nombre, apellido: share.sender_apellido },
      fecha_inicio: share.fecha_inicio,
      fecha_fin: share.fecha_fin,
      ...preview,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * POST /log-shares/:id/accept  (recipient)
 * Creates for the recipient the logs that were offered (the staged copy; missing ones only, existing
 * logs are never overwritten) and tells the sender how many were synced.
 */
exports.accept = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { share, error } = await loadPendingShare(conn, req.params.id, 'recipient_id', req.user.id);
    if (error) {
      await conn.rollback();
      return res.status(error.status).json({ message: error.message });
    }

    // Creates exactly the logs that were offered (the staged copy), never the sender's later changes
    const summary = await acceptShare(conn, share, share.recipient_id);

    await conn.query(
      `UPDATE log_shares
       SET status = 'accepted', created_count = ?, skipped_count = ?, responded_at = NOW()
       WHERE id = ?`,
      [summary.created, summary.skipped_existing, share.id]
    );
    await markRequestNotificationRead(conn, share.id);

    const me = await getUserName(conn, req.user.id);
    await createNotification(conn, {
      userId: share.sender_id,
      type: 'log_share_accepted',
      title: `${fullName(me)} aceptó tus logs`,
      message: `${fmtShort(share.fecha_inicio)} – ${fmtShort(share.fecha_fin)} · ${logsLabel(summary.created)} sincronizado${summary.created !== 1 ? 's' : ''}`,
      refId: share.id,
    });
    await conn.commit();

    return res.json({ id: share.id, status: 'accepted', summary });
  } catch (err) {
    try { await conn.rollback(); } catch { /* nothing to roll back */ }
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};

/**
 * POST /log-shares/:id/reject  (recipient)
 * Declines the request; the sender is notified.
 */
exports.reject = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { share, error } = await loadPendingShare(conn, req.params.id, 'recipient_id', req.user.id);
    if (error) {
      await conn.rollback();
      return res.status(error.status).json({ message: error.message });
    }

    await conn.query(
      `UPDATE log_shares SET status = 'rejected', responded_at = NOW() WHERE id = ?`,
      [share.id]
    );
    await markRequestNotificationRead(conn, share.id);

    const me = await getUserName(conn, req.user.id);
    await createNotification(conn, {
      userId: share.sender_id,
      type: 'log_share_rejected',
      title: `${fullName(me)} no recibió tus logs`,
      message: `${fmtShort(share.fecha_inicio)} – ${fmtShort(share.fecha_fin)} · rechazó la solicitud`,
      refId: share.id,
    });
    await conn.commit();

    return res.json({ id: share.id, status: 'rejected' });
  } catch (err) {
    try { await conn.rollback(); } catch { /* nothing to roll back */ }
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};

/**
 * POST /log-shares/:id/cancel  (sender)
 * Withdraws a request that has not been answered yet.
 */
exports.cancel = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { share, error } = await loadPendingShare(conn, req.params.id, 'sender_id', req.user.id);
    if (error) {
      await conn.rollback();
      return res.status(error.status).json({ message: error.message });
    }

    await conn.query(
      `UPDATE log_shares SET status = 'cancelled', responded_at = NOW() WHERE id = ?`,
      [share.id]
    );
    await markRequestNotificationRead(conn, share.id);
    await conn.commit();

    return res.json({ id: share.id, status: 'cancelled' });
  } catch (err) {
    try { await conn.rollback(); } catch { /* nothing to roll back */ }
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};
