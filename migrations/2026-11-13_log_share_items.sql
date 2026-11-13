-- Logs staged ("preparados") when a share request is sent.
-- Additive: only creates a new table; existing tables are not altered.
-- When a cleaner offers their logs, the logs are copied here at that moment. Accepting the request creates
-- exactly these logs for the recipient, so logs the sender adds, edits or deletes later do not change what was
-- offered. Requests sent before this migration have no rows here and keep the old behaviour (live copy).
-- No foreign key to daily_site_logs on purpose: the sender may delete the original log afterwards.
CREATE TABLE IF NOT EXISTS `log_share_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `share_id` int(11) NOT NULL,
  `source_log_id` int(11) DEFAULT NULL,
  `team_id` int(11) NOT NULL,
  `site_id` int(11) NOT NULL,
  `fecha` date NOT NULL,
  `horas_trabajadas` decimal(4,2) NOT NULL,
  `solo_bins` tinyint(1) DEFAULT 0,
  `observaciones` text DEFAULT NULL,
  `billing_week_id` int(11) DEFAULT NULL,
  `entry_type` enum('SERVICE','BINS','CUSTOM') DEFAULT NULL,
  `display_value` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_log_share_items_share` (`share_id`),
  CONSTRAINT `fk_log_share_items_share` FOREIGN KEY (`share_id`) REFERENCES `log_shares` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
