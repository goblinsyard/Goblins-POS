-- Delivery-app channels on orders (Talabat / Elmenus / Rabbit / phone)
CREATE TYPE "OrderChannel" AS ENUM ('IN_HOUSE', 'PHONE', 'TALABAT', 'ELMENUS', 'RABBIT');

ALTER TABLE "Order"
  ADD COLUMN "channel" "OrderChannel" NOT NULL DEFAULT 'IN_HOUSE',
  ADD COLUMN "externalRef" TEXT,
  ADD COLUMN "commissionCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryName" TEXT,
  ADD COLUMN "deliveryPhone" TEXT,
  ADD COLUMN "deliveryAddress" TEXT;

CREATE UNIQUE INDEX "Order_channel_externalRef_key" ON "Order"("channel", "externalRef");

-- Online booking with InstaPay / wallet deposits
CREATE TYPE "ReservationSource" AS ENUM ('STAFF', 'ONLINE');
CREATE TYPE "DepositStatus" AS ENUM ('NONE', 'AWAITING', 'RECEIVED', 'REFUNDED');

ALTER TABLE "Reservation"
  ADD COLUMN "source" "ReservationSource" NOT NULL DEFAULT 'STAFF',
  ADD COLUMN "bookingCode" TEXT,
  ADD COLUMN "depositStatus" "DepositStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "depositReference" TEXT;

CREATE UNIQUE INDEX "Reservation_bookingCode_key" ON "Reservation"("bookingCode");
