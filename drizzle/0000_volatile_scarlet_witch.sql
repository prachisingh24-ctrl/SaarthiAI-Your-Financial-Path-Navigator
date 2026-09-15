CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`department` text NOT NULL,
	`salt` text NOT NULL,
	`password_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assignments` (
	`job_id` text NOT NULL,
	`worker_id` text NOT NULL,
	`status` text DEFAULT 'Assigned' NOT NULL,
	PRIMARY KEY(`job_id`, `worker_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`worker_id`) REFERENCES `workers`(`worker_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_assignments_worker` ON `assignments` (`worker_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`department` text NOT NULL,
	`station` text NOT NULL,
	`location` text NOT NULL,
	`priority` text NOT NULL,
	`required_crew` integer NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`assigned_at` text,
	`simulated` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_department` ON `jobs` (`department`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workers` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`department_code` text NOT NULL,
	`department_name` text NOT NULL,
	`designation` text NOT NULL,
	`station_code` text NOT NULL,
	`station_name` text NOT NULL,
	`shift` text NOT NULL,
	`availability_status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workers_department` ON `workers` (`department_code`);
--> statement-breakpoint
CREATE TRIGGER prevent_overlapping_assignment BEFORE INSERT ON assignments
WHEN EXISTS (
 SELECT 1 FROM assignments a JOIN jobs existing ON existing.id=a.job_id JOIN jobs incoming ON incoming.id=NEW.job_id
 WHERE a.worker_id=NEW.worker_id AND existing.status='Assigned'
 AND incoming.start_at < existing.end_at AND incoming.end_at > existing.start_at
)
BEGIN
 SELECT RAISE(ABORT, 'worker assignment overlap');
END;
--> statement-breakpoint
CREATE TRIGGER prevent_reassigning_job BEFORE UPDATE OF status ON jobs
WHEN OLD.status='Assigned' AND NEW.status='Assigned'
BEGIN
 SELECT RAISE(ABORT, 'job already assigned');
END;
--> statement-breakpoint
CREATE TRIGGER prevent_excess_crew BEFORE INSERT ON assignments
WHEN (SELECT COUNT(*) FROM assignments WHERE job_id=NEW.job_id) >= (SELECT required_crew FROM jobs WHERE id=NEW.job_id)
BEGIN
 SELECT RAISE(ABORT, 'job already assigned');
END;
