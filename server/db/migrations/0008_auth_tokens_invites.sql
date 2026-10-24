CREATE TABLE `company_invites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`email` varchar(191) NOT NULL,
	`role` enum('admin','member','advisor') NOT NULL DEFAULT 'member',
	`token_hash` varchar(64) NOT NULL,
	`invited_by` int,
	`expires_at` datetime NOT NULL,
	`accepted_at` datetime,
	`accepted_by` int,
	`last_sent_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `company_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `invites_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `user_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`kind` enum('reset','verify') NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_tokens_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` datetime;--> statement-breakpoint
CREATE INDEX `invites_company_idx` ON `company_invites` (`company_id`);--> statement-breakpoint
CREATE INDEX `user_tokens_user_idx` ON `user_tokens` (`user_id`,`kind`);--> statement-breakpoint
UPDATE `users` SET `email_verified_at` = `created_at` WHERE `email_verified_at` IS NULL;
