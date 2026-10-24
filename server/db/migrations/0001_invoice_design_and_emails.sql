CREATE TABLE `sent_emails` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`sales_document_id` int,
	`kind` enum('document','reminder') NOT NULL DEFAULT 'document',
	`to` varchar(500) NOT NULL,
	`cc` varchar(500),
	`subject` varchar(255) NOT NULL,
	`with_pdf` boolean NOT NULL DEFAULT true,
	`status` enum('sent','failed') NOT NULL,
	`message_id` varchar(255),
	`error` varchar(500),
	`sent_by` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sent_emails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `emails_document_idx` ON `sent_emails` (`sales_document_id`,`created_at`);