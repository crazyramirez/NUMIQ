CREATE TABLE `advisor_packs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`label` varchar(120) NOT NULL,
	`period_from` date NOT NULL,
	`period_to` date NOT NULL,
	`contents` longtext,
	`path` varchar(500) NOT NULL,
	`size` int NOT NULL DEFAULT 0,
	`token` varchar(64) NOT NULL,
	`expires_at` datetime NOT NULL,
	`downloads` int NOT NULL DEFAULT 0,
	`sent_to` varchar(500),
	`sent_at` datetime,
	`email_status` enum('sent','failed'),
	`email_error` varchar(500),
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `advisor_packs_id` PRIMARY KEY(`id`),
	CONSTRAINT `packs_token_uq` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE INDEX `packs_company_idx` ON `advisor_packs` (`company_id`,`created_at`);