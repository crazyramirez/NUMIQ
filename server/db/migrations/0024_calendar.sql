CREATE TABLE `calendar_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`kind` enum('event','task') NOT NULL DEFAULT 'event',
	`title` varchar(200) NOT NULL,
	`notes` text,
	`location` varchar(200),
	`start_date` date NOT NULL,
	`end_date` date,
	`start_time` varchar(5),
	`end_time` varchar(5),
	`color` varchar(16) NOT NULL DEFAULT 'brand',
	`repeat` enum('none','weekly','monthly','quarterly','yearly') NOT NULL DEFAULT 'none',
	`repeat_interval` smallint NOT NULL DEFAULT 1,
	`repeat_until` date,
	`remind_minutes` int,
	`reminded_for` date,
	`done_dates` longtext,
	`contact_id` int,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `calendar_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calendar_feeds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`url` varchar(1000) NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT 'c1',
	`active` boolean NOT NULL DEFAULT true,
	`cache` longtext,
	`last_sync_at` datetime,
	`last_error` varchar(300),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `calendar_feeds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calendar_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`user_id` int NOT NULL,
	`token` varchar(64) NOT NULL,
	`layers` longtext,
	`last_used_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `calendar_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `cal_links_token_uq` UNIQUE(`token`),
	CONSTRAINT `cal_links_user_uq` UNIQUE(`company_id`,`user_id`)
);
--> statement-breakpoint
CREATE INDEX `cal_events_company_idx` ON `calendar_events` (`company_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `cal_feeds_user_idx` ON `calendar_feeds` (`company_id`,`user_id`);