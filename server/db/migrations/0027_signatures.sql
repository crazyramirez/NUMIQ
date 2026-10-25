CREATE TABLE `signatures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`name` varchar(60) NOT NULL,
	`kind` enum('drawn','typed','image') NOT NULL DEFAULT 'drawn',
	`path` varchar(500) NOT NULL,
	`width` int NOT NULL,
	`height` int NOT NULL,
	`is_default` boolean NOT NULL DEFAULT false,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `signatures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `signatures_company_idx` ON `signatures` (`company_id`);