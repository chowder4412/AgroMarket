import { Router, type IRouter } from "express";
import {
  and,
  count,
  desc,
  eq,
  sql,
} from "drizzle-orm";
import {
  db,
  farmsTable,
  paymentsTable,
  productsTable,
  sellerProfilesTable,
  usersTable,
  verificationCasesTable,
} from "@workspace/db";
import {
  GetAdminDashboardResponse,
  ListSellerVerificationsResponse,
  UpdateSellerVerificationBody,
  UpdateSellerVerificationParams,
  UpdateSellerVerificationResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();
const adminOnly = [requireAuth, requireRole("admin")];

router.get(
  "/admin/dashboard",
  ...adminOnly,
  async (_req, res): Promise<void> => {
    const [{ count: pendingVerifications }] = await db
      .select({ count: count(verificationCasesTable.id) })
      .from(verificationCasesTable)
      .where(eq(verificationCasesTable.status, "pending"));
    const [{ count: activeListings }] = await db
      .select({ count: count(productsTable.id) })
      .from(productsTable)
      .where(eq(productsTable.status, "active"));
    const [{ count: flaggedPayments }] = await db
      .select({ count: count(paymentsTable.id) })
      .from(paymentsTable)
      .where(eq(paymentsTable.status, "failed"));
    const [{ total: grossMerchandiseValueNgn }] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${paymentsTable.amountNgn}), 0)`,
      })
      .from(paymentsTable)
      .where(eq(paymentsTable.status, "paid"));
    res.json(
      GetAdminDashboardResponse.parse({
        pendingVerifications,
        activeListings,
        flaggedPayments,
        openDisputes: 0,
        grossMerchandiseValueNgn: Number(grossMerchandiseValueNgn),
      }),
    );
  },
);

router.get(
  "/admin/verifications",
  ...adminOnly,
  async (_req, res): Promise<void> => {
    const cases = await db
      .select({
        id: verificationCasesTable.id,
        sellerId: usersTable.clerkId,
        sellerName: usersTable.displayName,
        businessName: sellerProfilesTable.businessName,
        location: sellerProfilesTable.location,
        status: verificationCasesTable.status,
        submittedAt: verificationCasesTable.submittedAt,
      })
      .from(verificationCasesTable)
      .innerJoin(
        sellerProfilesTable,
        eq(verificationCasesTable.sellerId, sellerProfilesTable.id),
      )
      .innerJoin(usersTable, eq(sellerProfilesTable.userId, usersTable.id))
      .orderBy(desc(verificationCasesTable.status), desc(verificationCasesTable.submittedAt));
    res.json(ListSellerVerificationsResponse.parse(cases));
  },
);

router.patch(
  "/admin/verifications/:id/status",
  ...adminOnly,
  async (req, res): Promise<void> => {
    const params = UpdateSellerVerificationParams.safeParse(req.params);
    const parsed = UpdateSellerVerificationBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [caseRow] = await db
      .select()
      .from(verificationCasesTable)
      .where(eq(verificationCasesTable.id, params.data.id))
      .limit(1);
    if (!caseRow) {
      res.status(404).json({ error: "Verification case not found." });
      return;
    }
    await db
      .update(verificationCasesTable)
      .set({ status: parsed.data.status })
      .where(eq(verificationCasesTable.id, caseRow.id));
    await db
      .update(sellerProfilesTable)
      .set({
        verificationStatus: parsed.data.status,
        verified: parsed.data.status === "approved",
      })
      .where(eq(sellerProfilesTable.id, caseRow.sellerId));
    await db
      .update(farmsTable)
      .set({ verified: parsed.data.status === "approved" })
      .where(eq(farmsTable.sellerId, caseRow.sellerId));
    await db
      .update(productsTable)
      .set({
        status: parsed.data.status === "approved" ? "active" : "inactive",
      })
      .where(
        and(
          eq(productsTable.sellerId, caseRow.sellerId),
          eq(productsTable.status, "pending"),
        ),
      );
    const [response] = await db
      .select({
        id: verificationCasesTable.id,
        sellerId: usersTable.clerkId,
        sellerName: usersTable.displayName,
        businessName: sellerProfilesTable.businessName,
        location: sellerProfilesTable.location,
        status: verificationCasesTable.status,
        submittedAt: verificationCasesTable.submittedAt,
      })
      .from(verificationCasesTable)
      .innerJoin(
        sellerProfilesTable,
        eq(verificationCasesTable.sellerId, sellerProfilesTable.id),
      )
      .innerJoin(usersTable, eq(sellerProfilesTable.userId, usersTable.id))
      .where(eq(verificationCasesTable.id, caseRow.id));
    res.json(UpdateSellerVerificationResponse.parse(response));
  },
);

export default router;
