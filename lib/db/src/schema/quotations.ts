import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { productsTable } from "./catalog";
import { sellerProfilesTable, usersTable } from "./identity";

export const quotationStatusEnum = pgEnum("quotation_status", [
  "requested",
  "quoted",
  "accepted",
  "declined",
]);

export const quotationResponseStatusEnum = pgEnum("quotation_response_status", [
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

export const quotationResponsesTable = pgTable(
  "quotation_responses",
  {
    id: serial("id").primaryKey(),
    quotationId: integer("quotation_id")
      .notNull()
      .references(() => quotationsTable.id, { onDelete: "cascade" }),
    sellerId: integer("seller_id")
      .notNull()
      .references(() => sellerProfilesTable.id, { onDelete: "restrict" }),
    status: quotationResponseStatusEnum("status").notNull().default("quoted"),
    totalNgn: integer("total_ngn"),
    message: text("message").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique().on(table.quotationId, table.sellerId)],
);

export const insertQuotationSchema = createInsertSchema(quotationsTable).omit({
  id: true,
  createdAt: true,
});
export const insertQuotationItemSchema = createInsertSchema(
  quotationItemsTable,
).omit({ id: true });
export const insertQuotationResponseSchema = createInsertSchema(
  quotationResponsesTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type Quotation = typeof quotationsTable.$inferSelect;
export type QuotationItem = typeof quotationItemsTable.$inferSelect;
export type QuotationResponse = typeof quotationResponsesTable.$inferSelect;
