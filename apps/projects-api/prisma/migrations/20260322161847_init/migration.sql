-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `joined_at` DATETIME(3) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `password_salt` VARCHAR(255) NOT NULL,
    `organization` VARCHAR(255) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `owner_id` VARCHAR(64) NOT NULL,
    `owner_email` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NULL,
    `last_opened_at` DATETIME(3) NULL,
    `description` TEXT NULL,
    `root_path` VARCHAR(1024) NOT NULL,
    `imported` BOOLEAN NOT NULL DEFAULT false,
    `has_tex_file` BOOLEAN NOT NULL DEFAULT true,
    `files_index_json` JSON NOT NULL,

    INDEX `idx_projects_owner_email`(`owner_email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_collaborators` (
    `id` VARCHAR(64) NOT NULL,
    `project_id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NULL,
    `name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `role` ENUM('VIEWER', 'EDITOR', 'OWNER') NOT NULL,
    `status` ENUM('PENDING', 'APPROVED') NOT NULL DEFAULT 'APPROVED',
    `is_online` BOOLEAN NOT NULL DEFAULT false,
    `can_read` BOOLEAN NOT NULL DEFAULT true,
    `can_write` BOOLEAN NOT NULL DEFAULT true,

    INDEX `idx_project_collaborators_user_id`(`user_id`),
    UNIQUE INDEX `uniq_project_collaborator_email`(`project_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_collaborators` ADD CONSTRAINT `project_collaborators_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_collaborators` ADD CONSTRAINT `project_collaborators_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
