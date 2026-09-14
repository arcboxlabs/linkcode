ALTER TABLE `session_runs` ADD `run_id` text;--> statement-breakpoint
ALTER TABLE `session_runs` ADD `base_turn_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `session_runs_run_id_unique` ON `session_runs` (`run_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `origin_source_session_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `origin_source_turn_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `origin_forked_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `active_leaf_turn_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `graph_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `session_runs` SET `run_id` = 'run-' || lower(hex(randomblob(16))) WHERE `run_id` IS NULL;