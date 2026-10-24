CREATE TABLE `bank_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`account_id` int NOT NULL,
	`date` date NOT NULL,
	`value_date` date,
	`amount` decimal(14,2) NOT NULL DEFAULT 0,
	`description` varchar(500) NOT NULL,
	`counterparty` varchar(200),
	`reference` varchar(120),
	`bank_code` varchar(4),
	`balance` decimal(14,2),
	`hash` varchar(64) NOT NULL,
	`status` enum('pending','matched','ignored') NOT NULL DEFAULT 'pending',
	`suggestion` longtext,
	`sales_document_id` int,
	`expense_id` int,
	`payment_id` int,
	`owns_payment` boolean NOT NULL DEFAULT false,
	`ignore_reason` varchar(120),
	`matched_at` datetime,
	`matched_by` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `bank_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `bank_tx_hash_uq` UNIQUE(`company_id`,`hash`)
);
--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `last_import_at` datetime;--> statement-breakpoint
CREATE INDEX `bank_tx_company_idx` ON `bank_transactions` (`company_id`,`status`,`date`);--> statement-breakpoint
CREATE INDEX `bank_tx_account_idx` ON `bank_transactions` (`account_id`,`date`);