import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const workers = sqliteTable('workers', {
 worker_id:text().primaryKey(),name:text().notNull(),department_code:text().notNull(),department_name:text().notNull(),designation:text().notNull(),station_code:text().notNull(),station_name:text().notNull(),shift:text().notNull(),availability_status:text().notNull(),
},t=>[index('idx_workers_department').on(t.department_code)]);
export const accounts=sqliteTable('accounts',{id:text().primaryKey(),name:text().notNull(),role:text().notNull(),department:text().notNull(),salt:text().notNull(),password_hash:text().notNull()});
export const sessions=sqliteTable('sessions',{token_hash:text().primaryKey(),account_id:text().notNull().references(()=>accounts.id),expires_at:integer().notNull()});
export const maintenanceRequests=sqliteTable('maintenance_requests',{
 request_id:text().primaryKey(),department:text().notNull(),department_code:text().notNull(),task_type:text().notNull(),corridor_name:text().notNull(),line_type:text().notNull(),longitude:real().notNull(),latitude:real().notNull(),defect_severity:integer().notNull(),backlog_age_days:integer().notNull(),required_duration_mins:integer().notNull(),timestamp:text().notNull(),
},t=>[index('idx_requests_department_severity').on(t.department_code,t.defect_severity,t.backlog_age_days)]);
export const datasetImports=sqliteTable('dataset_imports',{name:text().primaryKey(),sha256:text().notNull(),row_count:integer().notNull(),imported_at:text().notNull()});
export const jobs=sqliteTable('jobs',{id:text().primaryKey(),title:text().notNull(),description:text().notNull(),department:text().notNull(),station:text().notNull(),location:text().notNull(),priority:text().notNull(),required_crew:integer().notNull(),start_at:text().notNull(),end_at:text().notNull(),status:text().notNull().default('Pending'),created_by:text().notNull(),created_at:text().notNull(),assigned_at:text(),started_at:text(),completed_at:text(),completed_by:text(),simulated:integer().notNull().default(0),source_request_id:text().references(()=>maintenanceRequests.request_id)},t=>[index('idx_jobs_department').on(t.department),uniqueIndex('idx_jobs_source_request').on(t.source_request_id)]);
export const assignments=sqliteTable('assignments',{job_id:text().notNull().references(()=>jobs.id),worker_id:text().notNull().references(()=>workers.worker_id),status:text().notNull().default('Assigned'),started_at:text(),completed_at:text()},t=>[primaryKey({columns:[t.job_id,t.worker_id]}),index('idx_assignments_worker').on(t.worker_id)]);

export const plannerPlans=sqliteTable("planner_plans",{id:text().primaryKey(),created_at:text().notNull(),created_by:text().notNull(),status:text().notNull().default("Draft"),revision:integer().notNull().default(1),payload:text().notNull()});
export const plannerFeedback=sqliteTable("planner_feedback",{id:text().primaryKey(),plan_id:text().notNull().references(()=>plannerPlans.id),block_id:text(),decision:text().notNull(),reason:text().notNull(),created_by:text().notNull(),created_at:text().notNull()});

// Versioned local input register and immutable solver snapshots for supplied data.
export const operationsState=sqliteTable('operations_state',{id:text().primaryKey(),revision:integer().notNull(),payload:text().notNull(),updated_at:text().notNull(),updated_by:text().notNull()});
export const operationsPlans=sqliteTable('operations_plans',{id:text().primaryKey(),revision:integer().notNull().default(1),input_revision:integer().notNull(),status:text().notNull().default('Draft'),payload:text().notNull(),created_at:text().notNull(),created_by:text().notNull()});
export const operationsAudit=sqliteTable('operations_audit',{id:text().primaryKey(),entity_id:text().notNull(),action:text().notNull(),reason:text().notNull(),actor:text().notNull(),created_at:text().notNull()});
export const operationsJobs=sqliteTable('operations_jobs',{job_id:text().primaryKey().references(()=>jobs.id),plan_id:text().notNull().references(()=>operationsPlans.id),block_id:text().notNull(),request_id:text().notNull().references(()=>maintenanceRequests.request_id),section_id:text().notNull()},t=>[uniqueIndex('idx_operations_request').on(t.request_id)]);
export const operationsTransactionGuard=sqliteTable('operations_transaction_guard',{id:text().primaryKey(),changed:integer().notNull()},t=>[check('operations_revision_required',sql`${t.changed}=1`)]);
