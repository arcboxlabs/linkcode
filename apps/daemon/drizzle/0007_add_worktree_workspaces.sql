CREATE TABLE `worktrees` (
	`worktree_path` text PRIMARY KEY NOT NULL,
	`repo_root` text NOT NULL,
	`branch` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktrees_repo_root_branch_unique` ON `worktrees` (`repo_root`,`branch`);--> statement-breakpoint
CREATE UNIQUE INDEX `worktrees_session_id_unique` ON `worktrees` (`session_id`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `parent_workspace_id` text;
