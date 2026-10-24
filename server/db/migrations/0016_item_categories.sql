CREATE TABLE `item_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_id` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`color` varchar(9),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `item_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `items` ADD `category_id` int;--> statement-breakpoint
CREATE INDEX `item_categories_company_idx` ON `item_categories` (`company_id`);--> statement-breakpoint
CREATE INDEX `items_category_idx` ON `items` (`category_id`);