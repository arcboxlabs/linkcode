CREATE TABLE `schedule_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`session_id` text,
	`error` text,
	`summary` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`schedule_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schedule_runs_schedule_started_idx` ON `schedule_runs` (`schedule_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`schedule_id` text PRIMARY KEY NOT NULL,
	`name` text,
	`prompt` text NOT NULL,
	`cadence_type` text NOT NULL,
	`cron_expression` text,
	`cron_timezone` text,
	`interval_ms` integer,
	`target_type` text NOT NULL,
	`target_session_id` text,
	`target_config_json` text,
	`status` text NOT NULL,
	`completed_reason` text,
	`next_run_at` integer,
	`last_run_at` integer,
	`run_count` integer DEFAULT 0 NOT NULL,
	`max_runs` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `schedules_next_run_at_idx` ON `schedules` (`next_run_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `automation_kind` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `automation_id` text;