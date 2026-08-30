CREATE TABLE `message_body_cache` (
	`account_id` integer NOT NULL,
	`message_id` text NOT NULL,
	`format` integer NOT NULL,
	`detail` text NOT NULL,
	`bytes` integer NOT NULL,
	`stored_at` integer NOT NULL,
	`used_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `message_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_body_cache_used_idx` ON `message_body_cache` (`used_at`);