-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "parentCategoryId" TEXT;

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
