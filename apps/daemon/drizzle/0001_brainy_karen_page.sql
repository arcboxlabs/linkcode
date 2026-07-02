CREATE TABLE `workspaces` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`cwd` text NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_cwd_unique` ON `workspaces` (`cwd`);--> statement-breakpoint
CREATE INDEX `workspaces_last_used_at_idx` ON `workspaces` (`last_used_at`);