CREATE TABLE `login_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`type` text NOT NULL,
	`success` integer NOT NULL,
	`user_agent` text
);
