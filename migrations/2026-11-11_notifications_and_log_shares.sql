-- Notifications + log sharing requests
-- Safe to run more than once (IF NOT EXISTS). Only creates new tables; it does not touch existing ones.

-- In-app notifications (one row per recipient).
-- `type` is a free string so new kinds of notifications don't need a migration.
-- `ref_id` points to the related entity (for log_share_* types it is log_shares.id).
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `type` varchar(50) NOT NULL,
  `title` varchar(150) NOT NULL,
  `message` text DEFAULT NULL,
  `ref_id` int(11) DEFAULT NULL,
  `data` text DEFAULT NULL COMMENT 'Optional JSON payload',
  `read_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user_read` (`user_id`,`read_at`,`created_at`),
  KEY `idx_notifications_ref` (`type`,`ref_id`),
  CONSTRAINT `fk_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A cleaner offering their logs for a date range to another cleaner.
-- The recipient decides: accepting copies the sender's logs in that range into the recipient's own logs.
CREATE TABLE IF NOT EXISTS `log_shares` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sender_id` int(11) NOT NULL,
  `recipient_id` int(11) NOT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `status` enum('pending','accepted','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `logs_count` int(11) NOT NULL DEFAULT 0 COMMENT 'Sender logs in the range when the request was sent',
  `created_count` int(11) DEFAULT NULL COMMENT 'Logs created for the recipient on accept',
  `skipped_count` int(11) DEFAULT NULL COMMENT 'Logs the recipient already had on accept',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `responded_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_log_shares_recipient` (`recipient_id`,`status`),
  KEY `idx_log_shares_sender` (`sender_id`,`status`),
  CONSTRAINT `fk_log_shares_sender` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_log_shares_recipient` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
