const db = require('../config/db');

/**
 * Creates an in-app notification for a user.
 * @param {object|null} executor - DB connection (inside a transaction) or null to use the pool.
 * @param {object} notification
 * @param {number} notification.userId - Recipient user id.
 * @param {string} notification.type - Notification kind, e.g. 'log_share_request'.
 * @param {string} notification.title - Short headline.
 * @param {string} [notification.message] - Longer description.
 * @param {number} [notification.refId] - Related entity id (e.g. log_shares.id).
 * @param {object} [notification.data] - Extra JSON payload.
 * @returns {Promise<number>} Inserted notification id.
 */
async function createNotification(executor, { userId, type, title, message = null, refId = null, data = null }) {
  const [result] = await (executor || db).query(
    `INSERT INTO notifications (user_id, type, title, message, ref_id, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, type, title, message, refId, data ? JSON.stringify(data) : null]
  );
  return result.insertId;
}

module.exports = { createNotification };
