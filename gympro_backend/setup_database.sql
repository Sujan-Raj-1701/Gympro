-- Migration: Drop legacy secondary columns from booking table if they exist
-- Run these manually if the Python migration script is not used.
-- Note: Wrap in IF EXISTS guards per MySQL version support.

ALTER TABLE `booking` DROP COLUMN IF EXISTS `eventdate_2`;
ALTER TABLE `booking` DROP COLUMN IF EXISTS `event_type_id_2`;
ALTER TABLE `booking` DROP COLUMN IF EXISTS `slot_id_2`;
ALTER TABLE `booking` DROP COLUMN IF EXISTS `expected_guests_2`;

-- Employee advances table (supports multiple advance entries per employee per month)
CREATE TABLE IF NOT EXISTS `employee_advances` (
	`id` INT AUTO_INCREMENT PRIMARY KEY,
	`account_code` VARCHAR(50) NOT NULL,
	`retail_code` VARCHAR(50) NOT NULL,
	`employee_id` INT NOT NULL,
	`month` VARCHAR(7) NOT NULL,
	`date` VARCHAR(10) NOT NULL,
	`amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
	`note` VARCHAR(255) NULL,
	`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	KEY `idx_scope_month` (`account_code`, `retail_code`, `month`),
	KEY `idx_emp` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
