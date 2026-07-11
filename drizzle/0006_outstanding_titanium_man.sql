CREATE TABLE `app_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`mail_cache_seconds` integer DEFAULT 60 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
