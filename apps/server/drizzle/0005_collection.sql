CREATE TABLE "card_collection" (
	"user_id" text NOT NULL,
	"edition_id" text NOT NULL,
	"card_id" text NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"first_won_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_won_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_collection_user_id_edition_id_card_id_pk" PRIMARY KEY("user_id","edition_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "profile_showcase" (
	"user_id" text PRIMARY KEY NOT NULL,
	"edition_id" text NOT NULL,
	"card_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_collection" ADD CONSTRAINT "card_collection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_showcase" ADD CONSTRAINT "profile_showcase_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;