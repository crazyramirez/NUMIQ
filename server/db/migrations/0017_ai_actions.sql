CREATE TABLE `ai_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`user_id` int NOT NULL,
	`conversation_id` int,
	`message_id` int,
	`kind` varchar(40) NOT NULL,
	`title` varchar(200) NOT NULL,
	`risk` enum('normal','high') NOT NULL DEFAULT 'normal',
	`status` enum('pending','running','done','failed','cancelled','undoing','undone') NOT NULL DEFAULT 'pending',
	`params` longtext,
	`preview` longtext,
	`result` longtext,
	`undo` longtext,
	`error` varchar(500),
	`expires_at` datetime NOT NULL,
	`executed_at` datetime,
	`undone_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ai_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ai_actions_conv_idx` ON `ai_actions` (`conversation_id`,`id`);--> statement-breakpoint
CREATE INDEX `ai_actions_company_idx` ON `ai_actions` (`company_id`,`created_at`);