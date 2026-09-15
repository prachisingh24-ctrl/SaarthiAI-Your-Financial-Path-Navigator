CREATE TABLE `dataset_imports` (
	`name` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`row_count` integer NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`department` text NOT NULL,
	`department_code` text NOT NULL,
	`task_type` text NOT NULL,
	`corridor_name` text NOT NULL,
	`line_type` text NOT NULL,
	`longitude` real NOT NULL,
	`latitude` real NOT NULL,
	`defect_severity` integer NOT NULL,
	`backlog_age_days` integer NOT NULL,
	`required_duration_mins` integer NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_requests_department_severity` ON `maintenance_requests` (`department_code`,`defect_severity`,`backlog_age_days`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_request_id` text REFERENCES maintenance_requests(request_id);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_source_request` ON `jobs` (`source_request_id`);