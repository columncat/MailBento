CREATE TABLE `message_flags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`message_id` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	`mark` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_flags_account_message_idx` ON `message_flags` (`account_id`,`message_id`);