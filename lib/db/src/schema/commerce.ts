import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  index,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { productUnitEnum, productsTable } from "./catalog";
import { sellerProfilesTable, usersTable } from "./identity";

export const orderStatusEnum = pgEnum("order_status", [
  "pending_payment",
  "paid",
  "processing",
  "in_transit",
  "delivered",
  "cancelled",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
]);

export const paymentModeEnum = pgEnum("payment_mode", [
  "sandbox",
  "provider_pending",
]);

export const paymentProviderEnum = pgEnum("payment_provider", [
  "sandbox",
  "paystack",
  "flutterwave",
]);

export const cartsTable = pgTable("carts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cartItemsTable = pgTable(
  "cart_items",
  {
    id: serial("id").primaryKey(),
    cartId: integer("cart_id")
      .notNull()
      .references(() => cartsTable.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => [unique().on(table.cartId, table.productId)],
);

export const ordersTable = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    orderNumber: varchar("order_number", { length: 40 }).notNull().unique(),
    orderGroupNumber: varchar("order_group_number", { length: 40 }),
    sellerId: integer("seller_id")
      .notNull()
      .references(() => sellerProfilesTable.id, { onDelete: "restrict" }),
    buyerId: integer("buyer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: orderStatusEnum("status").notNull().default("pending_payment"),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
    paymentMode: paymentModeEnum("payment_mode").notNull().default("sandbox"),
    totalNgn: integer("total_ngn").notNull(),
    deliveryAddress: text("delivery_address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("orders_order_group_number_idx").on(table.orderGroupNumber)],
);

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id")
    .notNull()
    .references(() => productsTable.id, { onDelete: "restrict" }),
  sellerId: integer("seller_id")
    .notNull()
    .references(() => sellerProfilesTable.id, { onDelete: "restrict" }),
  productName: text("product_name").notNull(),
  unit: productUnitEnum("unit").notNull(),
  unitPriceNgn: integer("unit_price_ngn").notNull(),
  quantity: integer("quantity").notNull(),
});

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  provider: paymentProviderEnum("provider").notNull().default("sandbox"),
  status: paymentStatusEnum("status").notNull().default("pending"),
  amountNgn: integer("amount_ngn").notNull(),
  providerReference: varchar("provider_reference", { length: 160 }).unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const checkoutPaymentsTable = pgTable("checkout_payments", {
  id: serial("id").primaryKey(),
  orderGroupNumber: varchar("order_group_number", { length: 40 })
    .notNull()
    .unique(),
  buyerId: integer("buyer_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  provider: paymentProviderEnum("provider").notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  amountNgn: integer("amount_ngn").notNull(),
  providerReference: varchar("provider_reference", { length: 160 })
    .notNull()
    .unique(),
  authorizationUrl: text("authorization_url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentWebhookEventsTable = pgTable("payment_webhook_events", {
  id: serial("id").primaryKey(),
  providerEventId: varchar("provider_event_id", { length: 200 })
    .notNull()
    .unique(),
  provider: paymentProviderEnum("provider").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertCartSchema = createInsertSchema(cartsTable).omit({
  id: true,
  createdAt: true,
});
export const insertCartItemSchema = createInsertSchema(cartItemsTable).omit({
  id: true,
});
export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
});
export const insertOrderItemSchema = createInsertSchema(orderItemsTable).omit({
  id: true,
});
export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({
  id: true,
  createdAt: true,
});

export type Cart = typeof cartsTable.$inferSelect;
export type CartItem = typeof cartItemsTable.$inferSelect;
export type Order = typeof ordersTable.$inferSelect;
export type OrderItem = typeof orderItemsTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
