CREATE TABLE `articles` (`slug` text PRIMARY KEY NOT NULL, `status` text NOT NULL, `published_at` text NOT NULL, `document` text NOT NULL, `revision` integer DEFAULT 1 NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_articles_status_date` ON `articles` (`status`,`published_at`);
--> statement-breakpoint
CREATE TABLE `watch_items` (`symbol` text PRIMARY KEY NOT NULL, `document` text NOT NULL, `revision` integer DEFAULT 1 NOT NULL);
--> statement-breakpoint
CREATE TABLE `cms_meta` (`id` text PRIMARY KEY NOT NULL);
