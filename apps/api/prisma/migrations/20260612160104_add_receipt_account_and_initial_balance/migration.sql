-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "initialBalanceCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "accountId" TEXT;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
