// SQL schema source. D1 executes the versioned migration, never runtime DDL.
export const schema = [
  'CREATE TABLE `articles` (`slug` text PRIMARY KEY NOT NULL, `status` text NOT NULL, `published_at` text NOT NULL, `document` text NOT NULL, `revision` integer DEFAULT 1 NOT NULL)',
  'CREATE INDEX `idx_articles_status_date` ON `articles` (`status`,`published_at`)',
  'CREATE TABLE `watch_items` (`symbol` text PRIMARY KEY NOT NULL, `document` text NOT NULL, `revision` integer DEFAULT 1 NOT NULL)',
  'CREATE TABLE `cms_meta` (`id` text PRIMARY KEY NOT NULL)',
];
