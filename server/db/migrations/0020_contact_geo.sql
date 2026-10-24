ALTER TABLE `contacts` ADD `geo_lat` decimal(9,6);--> statement-breakpoint
ALTER TABLE `contacts` ADD `geo_lng` decimal(9,6);--> statement-breakpoint
ALTER TABLE `contacts` ADD `geo_precision` enum('exact','street','area','none');--> statement-breakpoint
ALTER TABLE `contacts` ADD `geo_key` varchar(40);