/*
  Warnings:

  - You are about to drop the column `recipeId` on the `ProductionOrder` table. All the data in the column will be lost.
  - You are about to drop the column `outputIngredientId` on the `Recipe` table. All the data in the column will be lost.
  - Added the required column `manufacturingProcessId` to the `ProductionOrder` table without a default value. This is not possible if the table is not empty.
  - Made the column `menuItemId` on table `Recipe` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "ProductionOrder" DROP CONSTRAINT "ProductionOrder_recipeId_fkey";

-- DropForeignKey
ALTER TABLE "Recipe" DROP CONSTRAINT "Recipe_menuItemId_fkey";

-- DropForeignKey
ALTER TABLE "Recipe" DROP CONSTRAINT "Recipe_outputIngredientId_fkey";

-- DropIndex
DROP INDEX "Recipe_outputIngredientId_key";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "walletBalanceCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductionOrder" DROP COLUMN "recipeId",
ADD COLUMN     "manufacturingProcessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Recipe" DROP COLUMN "outputIngredientId",
ALTER COLUMN "menuItemId" SET NOT NULL;

-- CreateTable
CREATE TABLE "ManufacturingProcess" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outputIngredientId" TEXT NOT NULL,
    "yieldQty" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "prepInstructions" TEXT,
    "deductLocationName" TEXT NOT NULL DEFAULT 'Kitchen',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ManufacturingProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingProcessLine" (
    "id" TEXT NOT NULL,
    "manufacturingProcessId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "wastePct" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ManufacturingProcessLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingProcess_outputIngredientId_key" ON "ManufacturingProcess"("outputIngredientId");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingProcess" ADD CONSTRAINT "ManufacturingProcess_outputIngredientId_fkey" FOREIGN KEY ("outputIngredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingProcessLine" ADD CONSTRAINT "ManufacturingProcessLine_manufacturingProcessId_fkey" FOREIGN KEY ("manufacturingProcessId") REFERENCES "ManufacturingProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingProcessLine" ADD CONSTRAINT "ManufacturingProcessLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_manufacturingProcessId_fkey" FOREIGN KEY ("manufacturingProcessId") REFERENCES "ManufacturingProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
