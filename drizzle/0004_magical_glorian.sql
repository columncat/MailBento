CREATE TABLE `widget_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
