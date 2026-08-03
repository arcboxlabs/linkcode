ALTER TABLE `sessions` ADD `origin_parent_session_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `origin_source_history_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `origin_source_message_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `origin_branch_cursor` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `origin_branched_at` integer;