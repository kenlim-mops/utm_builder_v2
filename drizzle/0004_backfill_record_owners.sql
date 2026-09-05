UPDATE "campaigns"
SET "owner_id" = "created_by"
WHERE "owner_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = "campaigns"."created_by"
      AND "users"."active" = true
      AND "users"."role" <> 'investigator'
  );
--> statement-breakpoint
UPDATE "initiatives"
SET "owner_id" = "created_by"
WHERE "owner_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = "initiatives"."created_by"
      AND "users"."active" = true
      AND "users"."role" <> 'investigator'
  );
