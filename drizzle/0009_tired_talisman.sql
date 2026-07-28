CREATE TABLE `archived_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_account_id` integer,
	`source_label` text NOT NULL,
	`source_email` text DEFAULT '' NOT NULL,
	`source_icon_url` text,
	`source_message_id` text NOT NULL,
	`subject` text NOT NULL,
	`from_name` text,
	`from_email` text DEFAULT '' NOT NULL,
	`to_json` text DEFAULT '[]' NOT NULL,
	`cc_json` text DEFAULT '[]' NOT NULL,
	`received_at` integer NOT NULL,
	`snippet` text,
	`html` text,
	`text` text,
	`truncated` integer DEFAULT 0 NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	`mark` text,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `archived_messages_source_idx` ON `archived_messages` (`source_account_id`,`source_message_id`);--> statement-breakpoint
CREATE INDEX `archived_messages_position_idx` ON `archived_messages` (`position`);