CREATE TABLE `operations_transaction_guard` (
	`id` text PRIMARY KEY NOT NULL,
	`changed` integer NOT NULL,
	CONSTRAINT "operations_revision_required" CHECK("operations_transaction_guard"."changed"=1)
);
--> statement-breakpoint
CREATE TRIGGER operations_lock_approved_time BEFORE UPDATE OF start_at,end_at ON jobs
WHEN EXISTS (SELECT 1 FROM operations_jobs WHERE job_id=OLD.id)
AND (NEW.start_at<>OLD.start_at OR NEW.end_at<>OLD.end_at)
BEGIN SELECT RAISE(ABORT,'Controller-approved block times are locked'); END;
--> statement-breakpoint
CREATE TRIGGER operations_roster_changed AFTER UPDATE OF availability_status,shift,station_code,department_code ON workers
BEGIN UPDATE operations_state SET revision=revision+1 WHERE id='main'; END;
--> statement-breakpoint
CREATE TRIGGER operations_assignment_created AFTER INSERT ON assignments
BEGIN UPDATE operations_state SET revision=revision+1 WHERE id='main'; END;
--> statement-breakpoint
CREATE TRIGGER operations_assignment_removed AFTER DELETE ON assignments
BEGIN UPDATE operations_state SET revision=revision+1 WHERE id='main'; END;
--> statement-breakpoint
CREATE TRIGGER operations_job_changed AFTER UPDATE OF start_at,end_at,status ON jobs
BEGIN UPDATE operations_state SET revision=revision+1 WHERE id='main'; END;
