ALTER TABLE `users` ADD `openai_key` text;--> statement-breakpoint
ALTER TABLE `users` ADD `openai_key_hint` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `openai_key_at` datetime;