-- CreateEnum
CREATE TYPE "HrTxType" AS ENUM ('ADVANCE', 'BONUS', 'DEDUCTION', 'SALARY_PAYMENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "baseSalaryCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hourlyRateCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salaryType" TEXT NOT NULL DEFAULT 'MONTHLY';

-- CreateTable
CREATE TABLE "HrTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "HrTxType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdById" TEXT,
    "journalEntryId" TEXT,

    CONSTRAINT "HrTransaction_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "HrTransaction" ADD CONSTRAINT "HrTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTransaction" ADD CONSTRAINT "HrTransaction_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
