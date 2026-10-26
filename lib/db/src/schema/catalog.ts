import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sellerProfilesTable } from "./identity";

export const productCategoryEnum = pgEnum("product_category", [
  "produce",
  "foodstuff",
  "feeds",
  "seeds",
  "fertilizers",
  "equipment",
]);

export const productUnitEnum = pgEnum("product_unit", [
  "kg",
  "bag",
  "crate",
  "litre",
  "tonne",
  "piece",
]);

export const listingStatusEnum = pgEnum("listing_status", [
  "active",
  "inactive",
  "pending",
]);

export const farmsTable = pgTable("farms", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id")
    .notNull()
    .references(() => sellerProfilesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  location: text("location").notNull(),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  verified: boolean("verified").notNull().default(false),
  rating: real("rating").notNull().default(4.8),
});

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id")
    .notNull()
    .references(() => sellerProfilesTable.id, { onDelete: "cascade" }),
  farmId: integer("farm_id").references(() => farmsTable.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: productCategoryEnum("category").notNull(),
  unit: productUnitEnum("unit").notNull(),
  priceNgn: integer("price_ngn").notNull(),
  minOrder: integer("min_order").notNull().default(1),
  imageUrl: text("image_url").notNull().default(""),
  location: text("location").notNull(),
  status: listingStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const inventoryTable = pgTable("product_inventory", {
  productId: integer("product_id")
    .primaryKey()
    .references(() => productsTable.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const productWholesaleTiersTable = pgTable(
  "product_wholesale_tiers",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    minQuantity: integer("min_quantity").notNull(),
    unitPriceNgn: integer("unit_price_ngn").notNull(),
  },
  (table) => [unique().on(table.productId, table.minQuantity)],
);

export const insertFarmSchema = createInsertSchema(farmsTable).omit({
  id: true,
});
export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertInventorySchema = createInsertSchema(inventoryTable).omit({
  updatedAt: true,
});
export const insertProductWholesaleTierSchema = createInsertSchema(
  productWholesaleTiersTable,
).omit({ id: true });

export type Farm = typeof farmsTable.$inferSelect;
export type Product = typeof productsTable.$inferSelect;
export type Inventory = typeof inventoryTable.$inferSelect;
export type ProductWholesaleTier = typeof productWholesaleTiersTable.$inferSelect;
