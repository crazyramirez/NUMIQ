ALTER TABLE `recurrings` ADD `start_date` date;--> statement-breakpoint
ALTER TABLE `recurrings` ADD `run_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `recurrings` ADD `last_error` varchar(500);--> statement-breakpoint
ALTER TABLE `recurrings` ADD `created_by` int;