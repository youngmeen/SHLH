CREATE TABLE `applied` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notice_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`applied_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`priority` text,
	`result` text DEFAULT '미발표' NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sent_notice` (
	`notice_id` text PRIMARY KEY NOT NULL,
	`sent_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
