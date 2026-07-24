DROP INDEX `worktrees_session_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `worktrees_session_id_unique` ON `worktrees` (`session_id`);