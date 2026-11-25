-- AlterTable
ALTER TABLE `Event` ADD COLUMN `stitchStartedAt` DATETIME(3) NULL,
    ADD COLUMN `stitchedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `Setting` (
    `id` VARCHAR(191) NOT NULL,
    `retainSentryDays` INTEGER NOT NULL,
    `retainSavedDays` INTEGER NOT NULL,
    `retainRecentDays` INTEGER NOT NULL,
    `retainOriginalsDays` INTEGER NOT NULL,
    `minFreeGb` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
