CREATE TABLE `import_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`batch_id` int NOT NULL,
	`file_id` int,
	`position` int NOT NULL DEFAULT 0,
	`type` enum('sales','expense','contact','item','vault') NOT NULL,
	`status` enum('ready','warning','duplicate','error','imported','excluded') NOT NULL DEFAULT 'ready',
	`data` longtext,
	`contact_id` int,
	`duplicate` longtext,
	`confidence` smallint,
	`warnings` longtext,
	`result_id` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `import_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mail_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`mailbox` varchar(120) NOT NULL DEFAULT 'INBOX',
	`uid_validity` varchar(20),
	`uid` int NOT NULL,
	`message_id` varchar(255) NOT NULL,
	`from_name` varchar(200),
	`from_address` varchar(191),
	`subject` varchar(255),
	`date` datetime,
	`attachments` longtext,
	`addressed` boolean NOT NULL DEFAULT false,
	`status` enum('new','imported','ignored') NOT NULL DEFAULT 'new',
	`batch_id` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `mail_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `mail_message_uq` UNIQUE(`company_id`,`message_id`)
);
--> statement-breakpoint
ALTER TABLE `import_batches` ADD `source` enum('upload','scan','email') DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `name` varchar(200);--> statement-breakpoint
ALTER TABLE `import_batches` ADD `options` longtext;--> statement-breakpoint
CREATE INDEX `import_items_batch_idx` ON `import_items` (`batch_id`,`position`);--> statement-breakpoint
CREATE INDEX `mail_company_idx` ON `mail_messages` (`company_id`,`status`,`date`);