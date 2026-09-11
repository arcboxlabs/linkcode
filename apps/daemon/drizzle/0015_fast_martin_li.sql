CREATE TABLE `worktree_sessions` (
	`worktree_path` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`worktree_path`, `session_id`),
	FOREIGN KEY (`worktree_path`) REFERENCES `worktrees`(`worktree_path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_sessions_session_unique` ON `worktree_sessions` (`session_id`);--> statement-breakpoint
INSERT INTO `worktree_sessions` (`worktree_path`, `session_id`, `created_at`)
SELECT `worktree_path`, `session_id`, `created_at` FROM `worktrees`
WHERE `session_id` NOT LIKE 'orphan-worktree-%';--> statement-breakpoint
DROP INDEX `worktrees_session_id_unique`;--> statement-breakpoint
ALTER TABLE `worktrees` DROP COLUMN `session_id`;