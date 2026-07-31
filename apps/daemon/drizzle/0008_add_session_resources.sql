CREATE TABLE `session_resources` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`direction` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`locator_type` text NOT NULL,
	`locator` text NOT NULL,
	`normalized_locator_key` text,
	`mime_type` text,
	`size_bytes` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_resources_session_idx` ON `session_resources` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_resources_locator_idx` ON `session_resources` (`session_id`,`normalized_locator_key`);