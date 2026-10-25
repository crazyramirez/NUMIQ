CREATE TABLE `calendar_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`user_id` int NOT NULL,
	`provider` enum('google','caldav') NOT NULL,
	`label` varchar(200) NOT NULL,
	`server` varchar(500),
	`calendar_ref` varchar(1000),
	`owns_calendar` boolean NOT NULL DEFAULT true,
	`secret` text NOT NULL,
	`layers` longtext,
	`active` boolean NOT NULL DEFAULT true,
	`last_sync_at` datetime,
	`last_error` varchar(400),
	`synced_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `calendar_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `cal_accounts_user_uq` UNIQUE(`company_id`,`user_id`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `calendar_sync_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`account_id` int NOT NULL,
	`item_key` varchar(160) NOT NULL,
	`remote_id` varchar(1000) NOT NULL,
	`hash` varchar(64) NOT NULL,
	`date` date,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `calendar_sync_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `cal_sync_item_uq` UNIQUE(`account_id`,`item_key`)
);
--> statement-breakpoint
CREATE INDEX `cal_accounts_company_idx` ON `calendar_accounts` (`company_id`);