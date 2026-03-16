-- =============================================================================
-- Migración: Logs por equipo, reportes quincenales, registro diario tipo planner
-- Incluye: billing_weeks (semanas Lunes-Domingo), billing_periods (2 semanas),
-- extensión de daily_site_logs, reports y report_excluded_logs.
--
-- Orden: 1) billing_periods  2) billing_weeks  3) datos  4) daily_site_logs
--        5) reports  6) report_excluded_logs
--
-- Si daily_site_logs ya tiene las columnas nuevas, comenta el bloque 4.
-- Si la tabla reports ya existe, usa el bloque alternativo 5b en lugar de 5.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PERIODOS DE PAGO (2 semanas cada uno: Lunes semana 1 al Domingo semana 2)
-- Ejemplo: periodo 1 = 9 Mar al 22 Mar (cobro al final de semana 2)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_periods` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `start_date` date NOT NULL COMMENT 'Lunes de la semana 1 del periodo',
  `end_date` date NOT NULL COMMENT 'Domingo de la semana 2 del periodo',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_billing_periods_start` (`start_date`),
  KEY `idx_billing_periods_dates` (`start_date`,`end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. SEMANAS DE FACTURACIÓN (Lunes a Domingo)
-- Cada fila = una semana. Primera semana: Lunes 9 Mar al Domingo 15 Mar, etc.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_weeks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `start_date` date NOT NULL COMMENT 'Lunes',
  `end_date` date NOT NULL COMMENT 'Domingo',
  `period_id` int(11) DEFAULT NULL COMMENT 'FK a billing_periods; dos semanas por periodo',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_billing_weeks_start` (`start_date`),
  KEY `idx_billing_weeks_dates` (`start_date`,`end_date`),
  KEY `fk_billing_weeks_period` (`period_id`),
  CONSTRAINT `fk_billing_weeks_period` FOREIGN KEY (`period_id`) REFERENCES `billing_periods` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. DATOS INICIALES: primera semana Lunes 9 Mar 2025 - Domingo 15 Mar 2025
--    Periodo 1: 9 Mar - 22 Mar; Periodo 2: 23 Mar - 5 Abr; etc.
-- -----------------------------------------------------------------------------
INSERT INTO `billing_periods` (`id`, `start_date`, `end_date`) VALUES
(1, '2025-03-09', '2025-03-22'),
(2, '2025-03-23', '2025-04-05'),
(3, '2025-04-06', '2025-04-19'),
(4, '2025-04-20', '2025-05-03')
ON DUPLICATE KEY UPDATE end_date = VALUES(end_date);

INSERT INTO `billing_weeks` (`id`, `start_date`, `end_date`, `period_id`) VALUES
(1, '2025-03-09', '2025-03-15', 1),
(2, '2025-03-16', '2025-03-22', 1),
(3, '2025-03-23', '2025-03-29', 2),
(4, '2025-03-30', '2025-04-05', 2),
(5, '2025-04-06', '2025-04-12', 3),
(6, '2025-04-13', '2025-04-19', 3),
(7, '2025-04-20', '2025-04-26', 4),
(8, '2025-04-27', '2025-05-03', 4)
ON DUPLICATE KEY UPDATE end_date = VALUES(end_date), period_id = VALUES(period_id);

-- -----------------------------------------------------------------------------
-- 4. MODIFICAR daily_site_logs (omitir si las columnas ya existen)
-- entry_type / display_value para alinear con planner (SERVICE | BINS | CUSTOM)
-- billing_week_id para asignar cada log a una semana concreta del ciclo
-- -----------------------------------------------------------------------------
ALTER TABLE `daily_site_logs`
  ADD COLUMN `billing_week_id` int(11) DEFAULT NULL COMMENT 'Semana de facturación (Lun-Dom) a la que pertenece este log' AFTER `estado`,
  ADD COLUMN `entry_type` enum('SERVICE','BINS','CUSTOM') DEFAULT NULL COMMENT 'Tipo de entrada; NULL = registro legacy' AFTER `billing_week_id`,
  ADD COLUMN `display_value` decimal(10,2) DEFAULT NULL COMMENT 'Valor a cobrar (horas o monto bins/custom)' AFTER `entry_type`;

ALTER TABLE `daily_site_logs`
  ADD KEY `idx_daily_site_logs_billing_week` (`billing_week_id`);

ALTER TABLE `daily_site_logs`
  ADD CONSTRAINT `fk_daily_site_logs_billing_week` FOREIGN KEY (`billing_week_id`) REFERENCES `billing_weeks` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 5. TABLA reports (crear si no existe)
-- Cada usuario envía su propio reporte; fecha_inicio/fecha_fin = periodo (2 semanas)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL COMMENT 'Usuario que envía el reporte',
  `fecha_inicio` date NOT NULL COMMENT 'Lunes semana 1 del periodo',
  `fecha_fin` date NOT NULL COMMENT 'Domingo semana 2 del periodo',
  `billing_period_id` int(11) DEFAULT NULL COMMENT 'Periodo de facturación (opcional)',
  `estado` enum('borrador','enviado','aprobado') NOT NULL DEFAULT 'borrador',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_reports_user` (`user_id`),
  KEY `idx_reports_dates` (`fecha_inicio`,`fecha_fin`),
  KEY `fk_reports_billing_period` (`billing_period_id`),
  CONSTRAINT `fk_reports_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_reports_billing_period` FOREIGN KEY (`billing_period_id`) REFERENCES `billing_periods` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5b. Si la tabla reports YA existía (solo user_id, fecha_inicio, fecha_fin, estado),
--     ejecuta estos ALTER y omite el CREATE de arriba (o ejecuta 5b después del CREATE
--     si tu reports no tiene billing_period_id ni created_at/updated_at):
-- ALTER TABLE `reports` ADD COLUMN `billing_period_id` int(11) DEFAULT NULL AFTER `fecha_fin`;
-- ALTER TABLE `reports` ADD COLUMN `created_at` timestamp NULL DEFAULT current_timestamp() AFTER `estado`;
-- ALTER TABLE `reports` ADD COLUMN `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() AFTER `created_at`;
-- ALTER TABLE `reports` MODIFY `estado` enum('borrador','enviado','aprobado','generado') DEFAULT 'borrador';

-- -----------------------------------------------------------------------------
-- 6. TABLA report_excluded_logs (blacklist: logs que el usuario excluye del reporte)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `report_excluded_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `report_id` int(11) NOT NULL,
  `daily_site_log_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_report_excluded_log` (`report_id`,`daily_site_log_id`),
  KEY `fk_report_excluded_log` (`daily_site_log_id`),
  CONSTRAINT `fk_report_excluded_report` FOREIGN KEY (`report_id`) REFERENCES `reports` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_report_excluded_log` FOREIGN KEY (`daily_site_log_id`) REFERENCES `daily_site_logs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- NOTAS DE USO
-- =============================================================================
-- 1. billing_weeks: una fila por semana (Lunes–Domingo). Al crear un daily_site_log,
--    asignar billing_week_id con:
--    SELECT id FROM billing_weeks WHERE ? BETWEEN start_date AND end_date LIMIT 1;
--
-- 2. billing_periods: una fila por periodo de pago (2 semanas). Reporte "del 9 al 22"
--    = periodo con start_date 2025-03-09 y end_date 2025-03-22.
--
-- 3. daily_site_logs.entry_type / display_value: igual que en planner (SERVICE = horas,
--    BINS = pago_bins, CUSTOM = valor manual). Para reportes de cobro se usa display_value
--    (o horas_trabajadas si display_value es NULL por compatibilidad).
--
-- 4. report_excluded_logs: al generar el reporte el usuario marca logs a EXCLUIR;
--    los totales se calculan sobre daily_site_logs del usuario en el rango menos estos ids.
