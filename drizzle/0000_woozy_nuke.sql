CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"correlation_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"config_version" integer,
	"context" jsonb
);
--> statement-breakpoint
CREATE TABLE "batch_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_index" integer NOT NULL,
	"link_id" text,
	"status" text NOT NULL,
	"input" jsonb NOT NULL,
	"errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"row_count" integer NOT NULL,
	"succeeded_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"source" text DEFAULT 'grid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"utm_campaign" text NOT NULL,
	"initiative_id" text,
	"owner_id" text,
	"product" text,
	"campaign_type" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_versions" (
	"id" integer PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destination_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"kind" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_resolutions" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text,
	"existing_link_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_campaign_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"system" text NOT NULL,
	"external_type" text DEFAULT 'campaign' NOT NULL,
	"external_id" text,
	"external_name" text,
	"sync_state" text DEFAULT 'pending' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "initiatives" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" text,
	"product" text,
	"initiative_type" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"diff" jsonb,
	"reason" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"initiative_id" text,
	"batch_id" text,
	"destination_raw" text NOT NULL,
	"destination_normalized" text NOT NULL,
	"final_url" text NOT NULL,
	"utm_id" text NOT NULL,
	"utm_source" text NOT NULL,
	"utm_medium" text NOT NULL,
	"utm_campaign" text NOT NULL,
	"utm_content" text,
	"utm_term" text,
	"rp_initiative_id_param" text,
	"rp_link_id_param" text,
	"platform_preset_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"near_fingerprint" text NOT NULL,
	"duplicate_override" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"config_version" integer NOT NULL,
	"validation_state" text DEFAULT 'unvalidated' NOT NULL,
	"created_by" text NOT NULL,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"output_type" text NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"supported_macros" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"static_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verification_state" text DEFAULT 'draft' NOT NULL,
	"docs_url" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"triggered_by" text NOT NULL,
	"result" jsonb NOT NULL,
	"discrepancy_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"outbox_event_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "taxonomy_mediums" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taxonomy_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"medium_slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"severity" text DEFAULT 'error' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"kind" text DEFAULT 'syntactic' NOT NULL,
	"passed" boolean NOT NULL,
	"findings" jsonb NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batch_rows" ADD CONSTRAINT "batch_rows_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_rows" ADD CONSTRAINT "batch_rows_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_campaign_mappings" ADD CONSTRAINT "external_campaign_mappings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_revisions" ADD CONSTRAINT "link_revisions_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_attempts" ADD CONSTRAINT "sync_attempts_outbox_event_id_outbox_events_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_ts_idx" ON "audit_events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_rows_uq" ON "batch_rows" USING btree ("batch_id","row_index");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_utm_campaign_uq" ON "campaigns" USING btree ("utm_campaign");--> statement-breakpoint
CREATE INDEX "campaigns_initiative_idx" ON "campaigns" USING btree ("initiative_id");--> statement-breakpoint
CREATE UNIQUE INDEX "destination_policies_domain_uq" ON "destination_policies" USING btree ("domain","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_map_system_external_uq" ON "external_campaign_mappings" USING btree ("system","external_type","external_id") WHERE "external_campaign_mappings"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "ext_map_campaign_idx" ON "external_campaign_mappings" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "initiatives_name_uq" ON "initiatives" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "link_rev_uq" ON "link_revisions" USING btree ("link_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "links_fingerprint_active_uq" ON "links" USING btree ("fingerprint") WHERE "links"."status" <> 'retired' and "links"."duplicate_override" = false;--> statement-breakpoint
CREATE INDEX "links_campaign_idx" ON "links" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "links_initiative_idx" ON "links" USING btree ("initiative_id");--> statement-breakpoint
CREATE INDEX "links_batch_idx" ON "links" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "links_near_fp_idx" ON "links" USING btree ("near_fingerprint");--> statement-breakpoint
CREATE INDEX "links_created_at_idx" ON "links" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_uq" ON "outbox_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_presets_key_uq" ON "platform_presets" USING btree ("key");--> statement-breakpoint
CREATE INDEX "sync_attempts_event_idx" ON "sync_attempts" USING btree ("outbox_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "taxonomy_mediums_slug_uq" ON "taxonomy_mediums" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "taxonomy_sources_slug_uq" ON "taxonomy_sources" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "validation_runs_link_idx" ON "validation_runs" USING btree ("link_id");