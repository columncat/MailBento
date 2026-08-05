CREATE TABLE `seen_messages` (
	`account_id` integer NOT NULL,
	`message_id` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `message_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
