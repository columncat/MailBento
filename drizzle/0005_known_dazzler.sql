PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text DEFAULT 'imap' NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`imap_host` text,
	`imap_port` integer,
	`imap_username` text,
	`imap_password_enc` text,
	`query` text,
	`icon_url` text,
	`display_email` text,
	`web_url` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "provider", "display_name", "email", "imap_host", "imap_port", "imap_username", "imap_password_enc", "query", "icon_url", "display_email", "web_url", "position", "created_at", "updated_at") SELECT "id", "provider", "display_name", "email", "imap_host", "imap_port", "imap_username", "imap_password_enc", "query", "icon_url", "display_email", "web_url", "position", "created_at", "updated_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
UPDATE `accounts` SET `provider` = 'imap' WHERE `provider` = 'naver';--> statement-breakpoint
DELETE FROM `accounts` WHERE `provider` IN ('gmail', 'outlook', 'outlook_imap');--> statement-breakpoint
PRAGMA foreign_keys=ON;