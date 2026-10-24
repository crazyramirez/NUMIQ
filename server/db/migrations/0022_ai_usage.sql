CREATE TABLE `ai_usage` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int,
	`user_id` int,
	`day` date NOT NULL,
	`category` varchar(30) NOT NULL,
	`task` varchar(60) NOT NULL,
	`model` varchar(80) NOT NULL,
	`service_tier` varchar(20),
	`input_tokens` int NOT NULL DEFAULT 0,
	`cached_tokens` int NOT NULL DEFAULT 0,
	`cache_write_tokens` int NOT NULL DEFAULT 0,
	`output_tokens` int NOT NULL DEFAULT 0,
	`reasoning_tokens` int NOT NULL DEFAULT 0,
	`cost_usd` decimal(14,8) NOT NULL DEFAULT 0,
	`usd_per_eur` decimal(10,6),
	`ms` int NOT NULL DEFAULT 0,
	`ok` boolean NOT NULL DEFAULT true,
	`estimated` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ai_usage_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ai_usage_company_day_idx` ON `ai_usage` (`company_id`,`day`);--> statement-breakpoint
CREATE INDEX `ai_usage_company_created_idx` ON `ai_usage` (`company_id`,`created_at`);