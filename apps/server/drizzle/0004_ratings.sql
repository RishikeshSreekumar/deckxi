CREATE TABLE "ratings" (
	"user_id" text NOT NULL,
	"game_mode" text NOT NULL,
	"season_id" text NOT NULL,
	"rating" integer NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_user_id_game_mode_season_id_pk" PRIMARY KEY("user_id","game_mode","season_id")
);
--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;