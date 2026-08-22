CREATE TABLE "geocode" (
	"query" text PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"provider" text NOT NULL,
	"geocoded_at" timestamp with time zone DEFAULT now() NOT NULL
);
