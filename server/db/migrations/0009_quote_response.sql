ALTER TABLE `sales_documents` ADD `viewed_at` datetime;--> statement-breakpoint
ALTER TABLE `sales_documents` ADD `view_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_documents` ADD `responded_at` datetime;--> statement-breakpoint
ALTER TABLE `sales_documents` ADD `response_name` varchar(120);--> statement-breakpoint
ALTER TABLE `sales_documents` ADD `response_note` varchar(1000);