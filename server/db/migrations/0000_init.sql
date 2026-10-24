CREATE TABLE `audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int,
	`user_id` int,
	`action` varchar(60) NOT NULL,
	`entity` varchar(40),
	`entity_id` int,
	`data` longtext,
	`ip` varchar(45),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`bank_name` varchar(120),
	`iban` varchar(34),
	`balance` decimal(14,2) NOT NULL DEFAULT 0,
	`balance_at` datetime,
	`is_default` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `bank_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`kind` enum('expense','income') NOT NULL DEFAULT 'expense',
	`name` varchar(120) NOT NULL,
	`account_code` varchar(10),
	`icon` varchar(60),
	`color` varchar(9),
	`deductible_pct` decimal(5,2) NOT NULL DEFAULT 100,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('autonomo','sociedad') NOT NULL DEFAULT 'autonomo',
	`legal_name` varchar(200) NOT NULL,
	`trade_name` varchar(200),
	`nif` varchar(20) NOT NULL,
	`email` varchar(191),
	`phone` varchar(40),
	`website` varchar(200),
	`address` varchar(255),
	`postal_code` varchar(10),
	`city` varchar(120),
	`province` varchar(120),
	`country` varchar(2) NOT NULL DEFAULT 'ES',
	`iban` varchar(34),
	`logo_path` varchar(500),
	`activity_code` varchar(20),
	`activity_description` varchar(255),
	`tax_regime` enum('directa_simplificada','directa_normal','modulos','sociedades') NOT NULL DEFAULT 'directa_simplificada',
	`vat_regime` enum('general','recargo_equivalencia','criterio_caja','exento') NOT NULL DEFAULT 'general',
	`default_irpf_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`default_vat_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`payment_terms_days` smallint NOT NULL DEFAULT 30,
	`activity_start_date` date,
	`verifactu_enabled` boolean NOT NULL DEFAULT true,
	`brand_color` varchar(9),
	`invoice_footer` text,
	`settings` longtext,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `companies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `company_members` (
	`company_id` int NOT NULL,
	`user_id` int NOT NULL,
	`role` enum('owner','admin','member','advisor') NOT NULL DEFAULT 'member',
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `company_members_company_id_user_id_pk` PRIMARY KEY(`company_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`is_client` boolean NOT NULL DEFAULT false,
	`is_supplier` boolean NOT NULL DEFAULT false,
	`kind` enum('company','person') NOT NULL DEFAULT 'company',
	`name` varchar(200) NOT NULL,
	`trade_name` varchar(200),
	`nif` varchar(20),
	`nif_type` enum('nif','vat_eu','passport','other') NOT NULL DEFAULT 'nif',
	`email` varchar(191),
	`phone` varchar(40),
	`website` varchar(200),
	`address` varchar(255),
	`postal_code` varchar(10),
	`city` varchar(120),
	`province` varchar(120),
	`country` varchar(2) NOT NULL DEFAULT 'ES',
	`iban` varchar(34),
	`payment_terms_days` smallint,
	`irpf_rate` decimal(5,2),
	`equivalence_surcharge` boolean NOT NULL DEFAULT false,
	`default_category_id` int,
	`notes` text,
	`tags` longtext,
	`archived_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expense_tax_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`expense_id` int NOT NULL,
	`base` decimal(14,2) NOT NULL DEFAULT 0,
	`vat_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`vat_amount` decimal(14,2) NOT NULL DEFAULT 0,
	`surcharge_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`surcharge_amount` decimal(14,2) NOT NULL DEFAULT 0,
	CONSTRAINT `expense_tax_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`kind` enum('invoice','ticket','payroll','social_security','tax','other') NOT NULL DEFAULT 'invoice',
	`status` enum('pending','paid','partial') NOT NULL DEFAULT 'pending',
	`supplier_id` int,
	`supplier` longtext,
	`number` varchar(60),
	`issue_date` date NOT NULL,
	`due_date` date,
	`category_id` int,
	`description` varchar(255),
	`tax_base` decimal(14,2) NOT NULL DEFAULT 0,
	`vat_total` decimal(14,2) NOT NULL DEFAULT 0,
	`surcharge_total` decimal(14,2) NOT NULL DEFAULT 0,
	`irpf_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`irpf_total` decimal(14,2) NOT NULL DEFAULT 0,
	`total` decimal(14,2) NOT NULL DEFAULT 0,
	`paid_total` decimal(14,2) NOT NULL DEFAULT 0,
	`deductible_pct` decimal(5,2) NOT NULL DEFAULT 100,
	`vat_deductible_pct` decimal(5,2) NOT NULL DEFAULT 100,
	`reverse_charge` boolean NOT NULL DEFAULT false,
	`is_investment` boolean NOT NULL DEFAULT false,
	`payment_method` enum('transfer','card','cash','direct_debit','bizum','other'),
	`file_id` int,
	`ai_confidence` smallint,
	`reviewed` boolean NOT NULL DEFAULT true,
	`recurring_id` int,
	`notes` text,
	`paid_at` datetime,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`kind` enum('scan','import','attachment','vault','logo','pdf','receipt') NOT NULL DEFAULT 'scan',
	`original_name` varchar(255) NOT NULL,
	`source_path` varchar(500),
	`mime` varchar(100) NOT NULL,
	`size` int NOT NULL DEFAULT 0,
	`path` varchar(500) NOT NULL,
	`sha256` varchar(64),
	`year` smallint,
	`quarter` smallint,
	`folder` varchar(60),
	`notes` varchar(255),
	`batch_id` int,
	`ai_status` enum('none','pending','processing','done','failed') NOT NULL DEFAULT 'none',
	`ai_result` longtext,
	`ai_error` varchar(500),
	`linked_type` enum('expense','sales_document','contact','tax_filing'),
	`linked_id` int,
	`uploaded_by` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`direction` enum('issued','received','auto') NOT NULL DEFAULT 'auto',
	`status` enum('uploading','processing','review','done','failed') NOT NULL DEFAULT 'uploading',
	`total_files` int NOT NULL DEFAULT 0,
	`processed_files` int NOT NULL DEFAULT 0,
	`summary` longtext,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`finished_at` datetime,
	CONSTRAINT `import_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `insights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`key` varchar(120) NOT NULL,
	`severity` enum('info','success','warning','critical') NOT NULL DEFAULT 'info',
	`title` varchar(200) NOT NULL,
	`body` text,
	`action_label` varchar(60),
	`action_url` varchar(255),
	`data` longtext,
	`dismissed_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `insights_id` PRIMARY KEY(`id`),
	CONSTRAINT `insights_key_uq` UNIQUE(`company_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `invoice_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`layout` varchar(20) NOT NULL DEFAULT 'modern',
	`accent_color` varchar(9) NOT NULL DEFAULT '#4f46e5',
	`font` varchar(40) NOT NULL DEFAULT 'Inter',
	`logo_file_id` int,
	`options` longtext,
	`is_default` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoice_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`kind` enum('service','product') NOT NULL DEFAULT 'service',
	`name` varchar(200) NOT NULL,
	`description` text,
	`sku` varchar(60),
	`unit` varchar(20),
	`unit_price` decimal(14,4) NOT NULL DEFAULT 0,
	`vat_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`archived_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`direction` enum('in','out') NOT NULL,
	`sales_document_id` int,
	`expense_id` int,
	`amount` decimal(14,2) NOT NULL DEFAULT 0,
	`date` date NOT NULL,
	`method` enum('transfer','card','cash','direct_debit','bizum','other') NOT NULL DEFAULT 'transfer',
	`bank_account_id` int,
	`notes` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recurrings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`kind` enum('invoice','expense') NOT NULL,
	`name` varchar(160) NOT NULL,
	`frequency` enum('weekly','monthly','quarterly','yearly') NOT NULL DEFAULT 'monthly',
	`interval` smallint NOT NULL DEFAULT 1,
	`next_date` date NOT NULL,
	`end_date` date,
	`auto_issue` boolean NOT NULL DEFAULT false,
	`auto_send` boolean NOT NULL DEFAULT false,
	`template` longtext,
	`active` boolean NOT NULL DEFAULT true,
	`last_run_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recurrings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales_document_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`document_id` int NOT NULL,
	`position` smallint NOT NULL DEFAULT 0,
	`item_id` int,
	`description` text NOT NULL,
	`quantity` decimal(12,3) NOT NULL DEFAULT 1,
	`unit_price` decimal(14,4) NOT NULL DEFAULT 0,
	`discount_pct` decimal(5,2) NOT NULL DEFAULT 0,
	`vat_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`surcharge_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`irpf_applies` boolean NOT NULL DEFAULT true,
	`base` decimal(14,2) NOT NULL DEFAULT 0,
	CONSTRAINT `sales_document_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`kind` enum('quote','proforma','invoice','rectifying') NOT NULL DEFAULT 'invoice',
	`status` enum('draft','issued','sent','paid','partial','cancelled','accepted','rejected','expired','invoiced') NOT NULL DEFAULT 'draft',
	`series_id` int,
	`number` varchar(40),
	`sequence` int,
	`year` smallint,
	`issue_date` date NOT NULL,
	`due_date` date,
	`operation_date` date,
	`contact_id` int,
	`customer` longtext,
	`issuer` longtext,
	`subtotal` decimal(14,2) NOT NULL DEFAULT 0,
	`discount_total` decimal(14,2) NOT NULL DEFAULT 0,
	`tax_base` decimal(14,2) NOT NULL DEFAULT 0,
	`vat_total` decimal(14,2) NOT NULL DEFAULT 0,
	`surcharge_total` decimal(14,2) NOT NULL DEFAULT 0,
	`irpf_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`irpf_total` decimal(14,2) NOT NULL DEFAULT 0,
	`total` decimal(14,2) NOT NULL DEFAULT 0,
	`paid_total` decimal(14,2) NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'EUR',
	`payment_method` enum('transfer','card','cash','direct_debit','bizum','other') DEFAULT 'transfer',
	`notes` text,
	`terms` text,
	`rectifies_id` int,
	`rectification_code` varchar(2),
	`rectification_reason` varchar(255),
	`source_id` int,
	`recurring_id` int,
	`template_id` int,
	`imported` boolean NOT NULL DEFAULT false,
	`file_id` int,
	`public_token` varchar(64),
	`sent_at` datetime,
	`paid_at` datetime,
	`cancelled_at` datetime,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sales_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_number_uq` UNIQUE(`company_id`,`series_id`,`year`,`sequence`),
	CONSTRAINT `sales_token_uq` UNIQUE(`public_token`)
);
--> statement-breakpoint
CREATE TABLE `series` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`kind` enum('quote','proforma','invoice','rectifying') NOT NULL,
	`name` varchar(80) NOT NULL,
	`prefix` varchar(20) NOT NULL,
	`padding` smallint NOT NULL DEFAULT 4,
	`yearly_reset` boolean NOT NULL DEFAULT true,
	`is_default` boolean NOT NULL DEFAULT false,
	`archived_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `series_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `series_counters` (
	`series_id` int NOT NULL,
	`year` smallint NOT NULL,
	`last_number` int NOT NULL DEFAULT 0,
	CONSTRAINT `series_counters_series_id_year_pk` PRIMARY KEY(`series_id`,`year`)
);
--> statement-breakpoint
CREATE TABLE `tax_filings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`model` varchar(4) NOT NULL,
	`year` smallint NOT NULL,
	`period` varchar(2) NOT NULL,
	`status` enum('draft','ready','filed','paid') NOT NULL DEFAULT 'draft',
	`boxes` longtext,
	`result` decimal(14,2) NOT NULL DEFAULT 0,
	`due_date` date,
	`filed_at` datetime,
	`csv` varchar(40),
	`receipt_file_id` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tax_filings_id` PRIMARY KEY(`id`),
	CONSTRAINT `filings_period_uq` UNIQUE(`company_id`,`model`,`year`,`period`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(191) NOT NULL,
	`name` varchar(120) NOT NULL,
	`password_hash` varchar(255),
	`avatar_url` varchar(500),
	`current_company_id` int,
	`last_login_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verifactu_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`sales_document_id` int NOT NULL,
	`type` enum('alta','anulacion') NOT NULL DEFAULT 'alta',
	`issuer_nif` varchar(20) NOT NULL,
	`invoice_number` varchar(60) NOT NULL,
	`invoice_date` date NOT NULL,
	`invoice_type` varchar(2) NOT NULL,
	`vat_total` decimal(14,2) NOT NULL DEFAULT 0,
	`total` decimal(14,2) NOT NULL DEFAULT 0,
	`hash` varchar(64) NOT NULL,
	`previous_hash` varchar(64),
	`previous_id` int,
	`generated_at` varchar(32) NOT NULL,
	`xml` text,
	`status` enum('pending','sent','accepted','accepted_with_errors','rejected') NOT NULL DEFAULT 'pending',
	`aeat_csv` varchar(40),
	`aeat_response` longtext,
	`error` text,
	`sent_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `verifactu_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_company_idx` ON `audit_log` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bank_company_idx` ON `bank_accounts` (`company_id`);--> statement-breakpoint
CREATE INDEX `categories_company_idx` ON `categories` (`company_id`,`kind`);--> statement-breakpoint
CREATE INDEX `companies_nif_idx` ON `companies` (`nif`);--> statement-breakpoint
CREATE INDEX `members_user_idx` ON `company_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `contacts_company_idx` ON `contacts` (`company_id`,`is_client`,`is_supplier`);--> statement-breakpoint
CREATE INDEX `contacts_nif_idx` ON `contacts` (`company_id`,`nif`);--> statement-breakpoint
CREATE INDEX `expense_tax_expense_idx` ON `expense_tax_lines` (`expense_id`);--> statement-breakpoint
CREATE INDEX `expenses_company_idx` ON `expenses` (`company_id`,`issue_date`);--> statement-breakpoint
CREATE INDEX `expenses_supplier_idx` ON `expenses` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `expenses_category_idx` ON `expenses` (`category_id`);--> statement-breakpoint
CREATE INDEX `files_company_idx` ON `files` (`company_id`,`ai_status`);--> statement-breakpoint
CREATE INDEX `files_sha_idx` ON `files` (`company_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `files_period_idx` ON `files` (`company_id`,`year`,`quarter`);--> statement-breakpoint
CREATE INDEX `files_batch_idx` ON `files` (`batch_id`);--> statement-breakpoint
CREATE INDEX `import_company_idx` ON `import_batches` (`company_id`);--> statement-breakpoint
CREATE INDEX `templates_company_idx` ON `invoice_templates` (`company_id`);--> statement-breakpoint
CREATE INDEX `items_company_idx` ON `items` (`company_id`);--> statement-breakpoint
CREATE INDEX `payments_company_idx` ON `payments` (`company_id`,`date`);--> statement-breakpoint
CREATE INDEX `payments_sales_idx` ON `payments` (`sales_document_id`);--> statement-breakpoint
CREATE INDEX `payments_expense_idx` ON `payments` (`expense_id`);--> statement-breakpoint
CREATE INDEX `recurring_company_idx` ON `recurrings` (`company_id`,`active`,`next_date`);--> statement-breakpoint
CREATE INDEX `lines_document_idx` ON `sales_document_lines` (`document_id`);--> statement-breakpoint
CREATE INDEX `sales_company_idx` ON `sales_documents` (`company_id`,`kind`,`status`);--> statement-breakpoint
CREATE INDEX `sales_date_idx` ON `sales_documents` (`company_id`,`issue_date`);--> statement-breakpoint
CREATE INDEX `sales_contact_idx` ON `sales_documents` (`contact_id`);--> statement-breakpoint
CREATE INDEX `series_company_idx` ON `series` (`company_id`,`kind`);--> statement-breakpoint
CREATE INDEX `verifactu_company_idx` ON `verifactu_records` (`company_id`,`id`);--> statement-breakpoint
CREATE INDEX `verifactu_document_idx` ON `verifactu_records` (`sales_document_id`);