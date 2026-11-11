-- Sites created on the fly by cleaners ("sitios puntuales").
-- Additive: only creates a new table; existing tables are not altered.
-- A row here means "this site was typed in manually by a cleaner". The site itself lives in `sites`
-- like any other (so reports, logs and grids keep working), with no client and no team assignment.
-- `reviewed_at` is set when an admin edits the site, which removes the "puntual" flag in the UI.
CREATE TABLE IF NOT EXISTS `one_off_sites` (
  `site_id` int(11) NOT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `reviewed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`site_id`),
  KEY `idx_one_off_created_by` (`created_by`,`created_at`),
  CONSTRAINT `fk_one_off_site` FOREIGN KEY (`site_id`) REFERENCES `sites` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_one_off_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
