CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`access_token_enc` text,
	`refresh_token_enc` text,
	`expires_at` integer,
	`imap_host` text,
	`imap_port` integer,
	`imap_username` text,
	`imap_password_enc` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
