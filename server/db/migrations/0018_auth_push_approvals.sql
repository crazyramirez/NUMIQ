CREATE TABLE `push_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`endpoint` varchar(600) NOT NULL,
	`p256dh` varchar(200) NOT NULL,
	`auth` varchar(100) NOT NULL,
	`device` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`last_sent_at` datetime,
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_endpoint_uq` UNIQUE(`endpoint`)
);
--> statement-breakpoint
CREATE TABLE `user_passkeys` (
	`id` varchar(255) NOT NULL,
	`user_id` int NOT NULL,
	`public_key` text NOT NULL,
	`counter` int NOT NULL DEFAULT 0,
	`backed_up` boolean NOT NULL DEFAULT false,
	`transports` longtext,
	`name` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`last_used_at` datetime,
	CONSTRAINT `user_passkeys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `expenses` ADD `approval` enum('approved','pending','rejected') DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `approved_by` int;--> statement-breakpoint
ALTER TABLE `expenses` ADD `approved_at` datetime;--> statement-breakpoint
ALTER TABLE `expenses` ADD `reject_reason` varchar(300);--> statement-breakpoint
CREATE INDEX `push_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkeys_user_idx` ON `user_passkeys` (`user_id`);--> statement-breakpoint
CREATE INDEX `expenses_approval_idx` ON `expenses` (`company_id`,`approval`);