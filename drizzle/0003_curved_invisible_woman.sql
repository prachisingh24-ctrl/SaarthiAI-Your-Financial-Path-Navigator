CREATE TABLE `operations_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operations_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`block_id` text NOT NULL,
	`request_id` text NOT NULL,
	`section_id` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `operations_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `maintenance_requests`(`request_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_operations_request` ON `operations_jobs` (`request_id`);--> statement-breakpoint
CREATE TABLE `operations_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`input_revision` integer NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operations_state` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
