CREATE TABLE `conversation_operations` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`turn_id` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversation_operations_session_idx` ON `conversation_operations` (`session_id`);--> statement-breakpoint
CREATE TABLE `conversation_turns` (
	`turn_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_turn_id` text,
	`sibling_ordinal` integer NOT NULL,
	`input_type` text NOT NULL,
	`prompt_id` text,
	`command_name` text,
	`command_arguments` text,
	`shell_command` text,
	`run_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_turn_id`) REFERENCES `conversation_turns`(`turn_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompts`(`prompt_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversation_turns_session_idx` ON `conversation_turns` (`session_id`);--> statement-breakpoint
CREATE TABLE `prompt_attachment_refs` (
	`prompt_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	PRIMARY KEY(`prompt_id`, `attachment_id`),
	FOREIGN KEY (`prompt_id`) REFERENCES `prompts`(`prompt_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `prompts` (
	`prompt_id` text PRIMARY KEY NOT NULL,
	`blocks_json` text NOT NULL,
	`context_attachment_ids_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_turn_bindings` (
	`turn_id` text NOT NULL,
	`run_id` text NOT NULL,
	`history_id` text NOT NULL,
	`checkpoint` text NOT NULL,
	`captured_from` text NOT NULL,
	PRIMARY KEY(`turn_id`, `history_id`),
	FOREIGN KEY (`turn_id`) REFERENCES `conversation_turns`(`turn_id`) ON UPDATE no action ON DELETE cascade
);
