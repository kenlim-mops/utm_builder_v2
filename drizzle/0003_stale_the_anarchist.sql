CREATE TABLE "gtm_bulk_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"platform_key" text NOT NULL,
	"object_type" text NOT NULL,
	"operation" text NOT NULL,
	"format" text DEFAULT 'csv' NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_rows" integer,
	"availability_notes" text,
	"docs_url" text,
	"verification_state" text DEFAULT 'draft' NOT NULL,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_catalog_records" (
	"id" text PRIMARY KEY NOT NULL,
	"record_type" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sensitivity" text DEFAULT 'internal' NOT NULL,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"source_url" text,
	"source_updated_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_catalog_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"from_record_id" text NOT NULL,
	"to_record_id" text NOT NULL,
	"relationship_type" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_change_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_id" text NOT NULL,
	"source_record_id" text NOT NULL,
	"internal_record_id" text,
	"proposal_type" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_source_connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"mode" text DEFAULT 'poll' NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_ref" text,
	"authoritative_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_apply" boolean DEFAULT false NOT NULL,
	"schedule_minutes" integer DEFAULT 60 NOT NULL,
	"checkpoint" jsonb,
	"last_started_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"last_error" text,
	"lock_owner" text,
	"lock_expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_source_records" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_id" text NOT NULL,
	"external_id" text NOT NULL,
	"internal_record_id" text,
	"source_url" text,
	"content_hash" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_source_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"seen_count" integer DEFAULT 0 NOT NULL,
	"changed_count" integer DEFAULT 0 NOT NULL,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"proposed_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checkpoint" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "gtm_catalog_relationships" ADD CONSTRAINT "gtm_catalog_relationships_from_record_id_gtm_catalog_records_id_fk" FOREIGN KEY ("from_record_id") REFERENCES "public"."gtm_catalog_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_catalog_relationships" ADD CONSTRAINT "gtm_catalog_relationships_to_record_id_gtm_catalog_records_id_fk" FOREIGN KEY ("to_record_id") REFERENCES "public"."gtm_catalog_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_change_proposals" ADD CONSTRAINT "gtm_change_proposals_connector_id_gtm_source_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."gtm_source_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_change_proposals" ADD CONSTRAINT "gtm_change_proposals_source_record_id_gtm_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."gtm_source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_change_proposals" ADD CONSTRAINT "gtm_change_proposals_internal_record_id_gtm_catalog_records_id_fk" FOREIGN KEY ("internal_record_id") REFERENCES "public"."gtm_catalog_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_source_records" ADD CONSTRAINT "gtm_source_records_connector_id_gtm_source_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."gtm_source_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_source_records" ADD CONSTRAINT "gtm_source_records_internal_record_id_gtm_catalog_records_id_fk" FOREIGN KEY ("internal_record_id") REFERENCES "public"."gtm_catalog_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_source_sync_runs" ADD CONSTRAINT "gtm_source_sync_runs_connector_id_gtm_source_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."gtm_source_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gtm_bulk_templates_key_uq" ON "gtm_bulk_templates" USING btree ("key");--> statement-breakpoint
CREATE INDEX "gtm_bulk_templates_platform_idx" ON "gtm_bulk_templates" USING btree ("platform_key","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "gtm_catalog_type_key_uq" ON "gtm_catalog_records" USING btree ("record_type","key");--> statement-breakpoint
CREATE INDEX "gtm_catalog_type_lifecycle_idx" ON "gtm_catalog_records" USING btree ("record_type","lifecycle");--> statement-breakpoint
CREATE INDEX "gtm_catalog_verification_idx" ON "gtm_catalog_records" USING btree ("verification_state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gtm_relationship_edge_uq" ON "gtm_catalog_relationships" USING btree ("from_record_id","to_record_id","relationship_type");--> statement-breakpoint
CREATE INDEX "gtm_relationship_from_idx" ON "gtm_catalog_relationships" USING btree ("from_record_id","status");--> statement-breakpoint
CREATE INDEX "gtm_relationship_to_idx" ON "gtm_catalog_relationships" USING btree ("to_record_id","status");--> statement-breakpoint
CREATE INDEX "gtm_change_proposals_status_idx" ON "gtm_change_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "gtm_change_proposals_source_idx" ON "gtm_change_proposals" USING btree ("source_record_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "gtm_source_connectors_key_uq" ON "gtm_source_connectors" USING btree ("key");--> statement-breakpoint
CREATE INDEX "gtm_source_connectors_due_idx" ON "gtm_source_connectors" USING btree ("status","last_started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gtm_source_records_external_uq" ON "gtm_source_records" USING btree ("connector_id","external_id");--> statement-breakpoint
CREATE INDEX "gtm_source_records_internal_idx" ON "gtm_source_records" USING btree ("internal_record_id");--> statement-breakpoint
CREATE INDEX "gtm_source_sync_runs_connector_idx" ON "gtm_source_sync_runs" USING btree ("connector_id","started_at");