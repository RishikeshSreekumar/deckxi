-- better-auth 1.7 scopes account identity by (issuer, account_id) instead of
-- provider_id alone. Existing rows get the deterministic provider-namespace
-- issuer the 1.7 upgrade guide prescribes for 1.6 data; the column only goes
-- NOT NULL once every row has one, so this is safe on a populated table.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account"
SET "issuer" = CASE
  WHEN "provider_id" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || "provider_id"
END
WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_idx" ON "account" USING btree ("issuer","account_id");
