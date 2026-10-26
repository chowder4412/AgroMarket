import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  sellerProfilesTable,
  userRolesTable,
  usersTable,
  verificationCasesTable,
} from "@workspace/db";
import {
  GetAccountResponse,
  RequestAccountRoleBody,
  RequestAccountRoleResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

async function accountResponse(userId: number) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const roles = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));

  if (!user) return null;
  return GetAccountResponse.parse({
    id: user.id,
    displayName: user.displayName,
    roles: roles.map(({ role }) => role),
  });
}

router.get("/account", requireAuth, async (req, res): Promise<void> => {
  const account = await accountResponse(req.marketplaceUserId!);
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.json(account);
});

router.post("/account/roles", requireAuth, async (req, res): Promise<void> => {
  const parsed = RequestAccountRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.marketplaceUserId!;
  const { role, businessName, location } = parsed.data;
  await db
    .insert(userRolesTable)
    .values({ userId, role })
    .onConflictDoNothing();

  if (role === "farmer" || role === "supplier") {
    const [existing] = await db
      .select({ id: sellerProfilesTable.id })
      .from(sellerProfilesTable)
      .where(eq(sellerProfilesTable.userId, userId))
      .limit(1);
    if (!existing) {
      const [seller] = await db
        .insert(sellerProfilesTable)
        .values({
          userId,
          businessName:
            businessName?.trim() ||
            (role === "farmer" ? "New farm" : "New supplier"),
          location: location?.trim() || "Lagos, Nigeria",
        })
        .returning();
      if (seller) {
        await db.insert(verificationCasesTable).values({
          sellerId: seller.id,
          status: "pending",
        });
      }
    } else {
      await db
        .update(sellerProfilesTable)
        .set({
          businessName: businessName?.trim() || undefined,
          location: location?.trim() || undefined,
        })
        .where(and(eq(sellerProfilesTable.id, existing.id), eq(sellerProfilesTable.userId, userId)));
    }
  }

  const account = await accountResponse(userId);
  if (!account) {
    res.status(500).json({ error: "Could not update account roles." });
    return;
  }
  res.json(RequestAccountRoleResponse.parse(account));
});

export default router;
