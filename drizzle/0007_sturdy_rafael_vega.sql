ALTER TABLE `app_config` ADD `refresh_interval_seconds` integer DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_config` ADD `force_on_interval` integer DEFAULT 0 NOT NULL;