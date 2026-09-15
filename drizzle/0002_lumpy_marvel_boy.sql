CREATE TABLE `planner_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`block_id` text,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `planner_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `planner_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `assignments` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `assignments` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `completed_by` text;
--> statement-breakpoint
DROP TRIGGER prevent_overlapping_assignment;
--> statement-breakpoint
CREATE TRIGGER prevent_overlapping_assignment BEFORE INSERT ON assignments
WHEN EXISTS (
 SELECT 1 FROM assignments a JOIN jobs existing ON existing.id=a.job_id JOIN jobs incoming ON incoming.id=NEW.job_id
 WHERE a.worker_id=NEW.worker_id AND existing.status IN ('Assigned','In progress','Awaiting review')
 AND incoming.start_at < existing.end_at AND incoming.end_at > existing.start_at
)
BEGIN SELECT RAISE(ABORT, 'worker assignment overlap'); END;
