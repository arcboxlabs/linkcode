CREATE TABLE `loop_iterations` (
	`loop_id` text NOT NULL,
	`index` integer NOT NULL,
	`status` text NOT NULL,
	`worker_session_id` text,
	`verifier_session_id` text,
	`checks_json` text NOT NULL,
	`verdict_json` text,
	`error` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	PRIMARY KEY(`loop_id`, `index`),
	FOREIGN KEY (`loop_id`) REFERENCES `loops`(`loop_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `loops` (
	`loop_id` text PRIMARY KEY NOT NULL,
	`spec_json` text NOT NULL,
	`status` text NOT NULL,
	`iteration_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`summary` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer
);
