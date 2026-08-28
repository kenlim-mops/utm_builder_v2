CREATE TABLE "warehouse_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_snapshots_key_uq" ON "warehouse_snapshots" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "warehouse_snapshots_entity_idx" ON "warehouse_snapshots" USING btree ("entity_type","entity_id");