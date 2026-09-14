CREATE TABLE `attachment_blobs` (
	`attachment_id` text NOT NULL,
	`variant` text NOT NULL,
	`blob_id` text NOT NULL,
	PRIMARY KEY(`attachment_id`, `variant`),
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`attachment_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blob_id`) REFERENCES `blobs`(`blob_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachment_blobs_blob_idx` ON `attachment_blobs` (`blob_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`attachment_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`metadata_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blobs` (
	`blob_id` text PRIMARY KEY NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `upload_leases` (
	`upload_id` text PRIMARY KEY NOT NULL,
	`declared_sha256` text NOT NULL,
	`declared_size` integer NOT NULL,
	`name` text NOT NULL,
	`mime_type` text,
	`kind` text NOT NULL,
	`blob_id` text,
	`attachment_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `upload_leases_expires_at_idx` ON `upload_leases` (`expires_at`);--> statement-breakpoint
ALTER TABLE `session_resources` ADD `attachment_id` text;