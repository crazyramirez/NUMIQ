CREATE TABLE `certificates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`holder_name` varchar(200) NOT NULL,
	`holder_nif` varchar(20),
	`representative_name` varchar(200),
	`representative_nif` varchar(20),
	`kind` enum('persona','representante','sello','otro') NOT NULL DEFAULT 'persona',
	`issuer` varchar(200),
	`serial` varchar(80),
	`fingerprint` varchar(100) NOT NULL,
	`valid_from` datetime NOT NULL,
	`valid_to` datetime NOT NULL,
	`path` varchar(500) NOT NULL,
	`uploaded_by` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `certificates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `certificates_company_idx` ON `certificates` (`company_id`);