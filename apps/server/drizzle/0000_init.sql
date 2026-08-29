CREATE TABLE "match_events" (
	"match_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "match_events_match_id_seq_pk" PRIMARY KEY("match_id","seq")
);
--> statement-breakpoint
CREATE TABLE "match_players" (
	"match_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"seat" integer NOT NULL,
	CONSTRAINT "match_players_match_id_session_id_pk" PRIMARY KEY("match_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"room_code" text NOT NULL,
	"edition_id" text NOT NULL,
	"game_mode" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"winner_session_id" text,
	"end_reason" text,
	"rounds" integer
);
--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;