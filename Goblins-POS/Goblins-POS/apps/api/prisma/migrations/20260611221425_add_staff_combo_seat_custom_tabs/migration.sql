-- CreateTable
CREATE TABLE "OrderSeatCustomer" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "OrderSeatCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderSeatCustomer_orderId_seat_key" ON "OrderSeatCustomer"("orderId", "seat");

-- AddForeignKey
ALTER TABLE "OrderSeatCustomer" ADD CONSTRAINT "OrderSeatCustomer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSeatCustomer" ADD CONSTRAINT "OrderSeatCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
