-- AlterEnum
ALTER TYPE "HrTxType" ADD VALUE 'TIPS';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deservesBonus" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipsPoints" INTEGER NOT NULL DEFAULT 0;
