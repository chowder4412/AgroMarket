import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { productsTable } from "./catalog";
import { usersTable } from "./identity";

export const quotationStatusEnum = pgEnum("quotation_status", [
  "requested",
  "quoted",
  "accepted",
  "declined",
]);

export const quotationsTable = pgTable("quotations", {
  id: serial("id").primaryKey(),
  buyerId: integer("buyer_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  notes: text("notes").notNull().default(""),
  status: quotationStatusEnum("status").notNull().default("requested"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const quotationItemsTable = pgTable("quotation_items", {
  id: serial("id").primaryKey(),
  quotationId: integer("quotation_id")
    .notNull()
    .references(() => quotationsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id")
    .notNull()
    .references(() => productsTable.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
});

export const insertQuotationSchema = createInsertSchema(quotationsTable).omit({
  id: true,
  createdAt: true,
});
export const insertQuotationItemSchema = createInsertSchema(
  quotationItemsTable,
).omit({ id: true });

export type Quotation = typeof quotationsTable.$inferSelect;
export type QuotationItem = typeof quotationItemsTable.$inferSelect;
