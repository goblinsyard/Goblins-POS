-- Add default routing station to Category
ALTER TABLE "Category" ADD COLUMN "stationId" TEXT;

ALTER TABLE "Category" ADD CONSTRAINT "Category_stationId_fkey"
  FOREIGN KEY ("stationId") REFERENCES "Station"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
