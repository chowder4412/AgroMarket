import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  integer,
  varchar,
} from "drizzle-orm/pg-core";

export const marketplaceRoleEnum = pgEnum("marketplace_role", [
  "consumer",
  "farmer",
  "supplier",
  "business_buyer",
  "admin",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "pending",
  "approved",
  "rejected",
]);

export const usersTable = pgTable("marketplace_users", {
  id: serial("id").primaryKey(),
  clerkId: varchar("clerk_id", { length: 128 }).notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userRolesTable = pgTable(
  "marketplace_user_roles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: marketplaceRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.userId, table.role)],
);

export const sellerProfilesTable = pgTable("seller_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  location: text("location").notNull(),
  verificationStatus: verificationStatusEnum("verification_status")
    .notNull()
    .default("pending"),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verificationCasesTable = pgTable("seller_verification_cases", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id")
    .notNull()
    .references(() => sellerProfilesTable.id, { onDelete: "cascade" }),
  status: verificationStatusEnum("status").notNull().default("pending"),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export const insertUserRoleSchema = createInsertSchema(userRolesTable).omit({
  id: true,
  createdAt: true,
});
export const insertSellerProfileSchema = createInsertSchema(
  sellerProfilesTable,
).omit({ id: true, createdAt: true });
export const insertVerificationCaseSchema = createInsertSchema(
  verificationCasesTable,
).omit({ id: true, submittedAt: true });

export type User = typeof usersTable.$inferSelect;
export type UserRole = typeof userRolesTable.$inferSelect;
export type SellerProfile = typeof sellerProfilesTable.$inferSelect;
export type VerificationCase = typeof verificationCasesTable.$inferSelect;
