import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { ordersTable } from "./commerce";
import { sellerProfilesTable, usersTable } from "./identity";

export const orderDisputeStatusEnum = pgEnum("order_dispute_status", [
  "open",
  "reviewing",
  "resolved",
  "rejected",
]);

export const orderDisputesTable = pgTable(
  "order_disputes",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    buyerId: integer("buyer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    sellerId: integer("seller_id")
      .notNull()
      .references(() => sellerProfilesTable.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    details: text("details").notNull(),
    status: orderDisputeStatusEnum("status").notNull().default("open"),
    resolutionNote: text("resolution_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.orderId, table.buyerId),
    index("order_disputes_status_idx").on(table.status),
  ],
);

export const insertOrderDisputeSchema = createInsertSchema(orderDisputesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type OrderDispute = typeof orderDisputesTable.$inferSelect;