const db = require('../config/db');

/**
 * Parses the optional JSON payload stored as text.
 * @param {string|object|null} raw - Value from the `data` column.
 * @returns {object|null}
 */
function parseData(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * GET /notifications
 * Lists the authenticated user's notifications, newest first.
 * Query: limit (1-100, default 30), unread=1 to only return unread ones.
 * For log share requests it also returns `share_status` so the UI knows whether
 * the request can still be accepted/rejected.
 */
exports.list = async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const onlyUnread = req.query.unread === '1' || req.query.unread === 'true';

  try {
    const [rows] = await db.query(
      `SELECT n.id, n.type, n.title, n.message, n.ref_id, n.data, n.read_at, n.created_at,
              ls.status AS share_status
       FROM notifications n
       LEFT JOIN log_shares ls ON n.type = 'log_share_request' AND ls.id = n.ref_id
       WHERE n.user_id = ? ${onlyUnread ? 'AND n.read_at IS NULL' : ''}
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ?`,
      [req.user.id, limit]
    );

    const [[{ unread_count }]] = await db.query(
      'SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [req.user.id]
    );

    return res.json({
      unread_count: Number(unread_count),
      notifications: rows.map((row) => ({ ...row, data: parseData(row.data) })),
    });
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * GET /notifications/unread-count
 * Lightweight endpoint meant to be polled by the app for the bell badge.
 */
exports.unreadCount = async (req, res) => {
  try {
    const [[{ unread_count }]] = await db.query(
      'SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [req.user.id]
    );
    return res.json({ unread_count: Number(unread_count) });
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * PATCH /notifications/:id/read
 * Marks one of the user's notifications as read (no-op if it already is).
 */
exports.markRead = async (req, res) => {
  try {
    const [result] = await db.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
       WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Notificación no encontrada' });
    }
    return res.json({ message: 'Notificación marcada como leída' });
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * POST /notifications/read-all
 * Marks every unread notification of the user as read.
 */
exports.markAllRead = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL',
      [req.user.id]
    );
    return res.json({ message: 'Notificaciones marcadas como leídas', updated: result.affectedRows });
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
