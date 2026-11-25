-- AlterTable
ALTER TABLE `Device` ADD COLUMN `alertLowBatteryAt` DATETIME(3) NULL,
    ADD COLUMN `alertLowCardAt` DATETIME(3) NULL,
    ADD COLUMN `alertOfflineAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Event` ADD COLUMN `notifiedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `NotificationSettings` (
    `id` VARCHAR(191) NOT NULL,
    `smtpHost` VARCHAR(255) NULL,
    `smtpPort` INTEGER NULL,
    `smtpSecure` BOOLEAN NULL,
    `smtpUser` VARCHAR(255) NULL,
    `smtpPasswordSealed` TEXT NULL,
    `smtpFrom` VARCHAR(255) NULL,
    `smtpReplyTo` VARCHAR(255) NULL,
    `recipients` TEXT NULL,
    `notifySentry` BOOLEAN NOT NULL DEFAULT true,
    `notifySaved` BOOLEAN NOT NULL DEFAULT true,
    `notifyDaily` BOOLEAN NOT NULL DEFAULT true,
    `dailyTime` VARCHAR(5) NOT NULL DEFAULT '08:00',
    `dailySkipEmpty` BOOLEAN NOT NULL DEFAULT true,
    `lastSummaryAt` DATETIME(3) NULL,
    `notifyAlerts` BOOLEAN NOT NULL DEFAULT false,
    `alertBatteryV` DOUBLE NOT NULL DEFAULT 3.5,
    `alertCardGb` INTEGER NOT NULL DEFAULT 5,
    `alertOfflineHours` INTEGER NOT NULL DEFAULT 24,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Events already stitched before this migration must not be mailed now.
UPDATE `Event` SET `notifiedAt` = CURRENT_TIMESTAMP(3) WHERE `stitchStatus` = 'DONE';
