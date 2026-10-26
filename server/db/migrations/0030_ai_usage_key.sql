ALTER TABLE `ai_usage` ADD `key_user_id` int;--> statement-breakpoint
ALTER TABLE `ai_usage` ADD `key_hint` varchar(20);--> statement-breakpoint
CREATE INDEX `ai_usage_key_day_idx` ON `ai_usage` (`key_user_id`,`day`);