CREATE TABLE `image_uploads` (`id` text PRIMARY KEY NOT NULL, `owner` text NOT NULL, `storage_path` text NOT NULL, `document` text NOT NULL, `state` text NOT NULL, `post_slug` text, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_image_uploads_owner_state` ON `image_uploads` (`owner`,`state`,`created_at`);
