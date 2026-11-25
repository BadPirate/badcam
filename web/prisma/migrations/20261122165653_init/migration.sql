-- CreateTable
CREATE TABLE `Device` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NULL,
    `lastStatus` TEXT NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Device_name_key`(`name`),
    UNIQUE INDEX `Device_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Event` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `kind` ENUM('SENTRY', 'SAVED', 'RECENT') NOT NULL,
    `key` VARCHAR(32) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,
    `triggerAt` DATETIME(3) NULL,
    `city` VARCHAR(120) NULL,
    `lat` DOUBLE NULL,
    `lon` DOUBLE NULL,
    `reason` VARCHAR(120) NULL,
    `camera` VARCHAR(32) NULL,
    `rawJson` TEXT NULL,
    `uploadComplete` BOOLEAN NOT NULL DEFAULT false,
    `lastUploadAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `stitchStatus` ENUM('PENDING', 'QUEUED', 'RUNNING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `stitchError` TEXT NULL,
    `stitchedBytes` BIGINT NOT NULL DEFAULT 0,
    `durationSec` INTEGER NULL,
    `hasPoster` BOOLEAN NOT NULL DEFAULT false,
    `hasHighlight` BOOLEAN NOT NULL DEFAULT false,
    `originalsBytes` BIGINT NOT NULL DEFAULT 0,
    `originalsDeletedAt` DATETIME(3) NULL,
    `starred` BOOLEAN NOT NULL DEFAULT false,
    `viewedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Event_deletedAt_startedAt_idx`(`deletedAt`, `startedAt`),
    INDEX `Event_stitchStatus_idx`(`stitchStatus`),
    UNIQUE INDEX `Event_deviceId_kind_key_key`(`deviceId`, `kind`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Clip` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `camera` VARCHAR(32) NULL,
    `minuteKey` VARCHAR(19) NULL,
    `size` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `valid` BOOLEAN NOT NULL DEFAULT true,
    `durationSec` DOUBLE NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fileDeleted` BOOLEAN NOT NULL DEFAULT false,

    INDEX `Clip_eventId_minuteKey_idx`(`eventId`, `minuteKey`),
    UNIQUE INDEX `Clip_deviceId_path_key`(`deviceId`, `path`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Segment` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `minuteKey` VARCHAR(19) NOT NULL,
    `status` ENUM('PENDING', 'QUEUED', 'RUNNING', 'DONE', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `durationSec` DOUBLE NULL,
    `error` TEXT NULL,

    UNIQUE INDEX `Segment_eventId_minuteKey_key`(`eventId`, `minuteKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobRun` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `runKey` VARCHAR(64) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `outcome` VARCHAR(500) NULL,

    UNIQUE INDEX `JobRun_name_runKey_key`(`name`, `runKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Clip` ADD CONSTRAINT `Clip_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Clip` ADD CONSTRAINT `Clip_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Segment` ADD CONSTRAINT `Segment_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
