import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, marketplaceRoleEnum, userRolesTable, usersTable } from "@workspace/db";

type MarketplaceRole = (typeof marketplaceRoleEnum.enumValues)[number];

declare global {
  namespace Express {
    interface Request {
      marketplaceUserId?: number;
      clerkUserId?: string;
    }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth.userId;
    if (!clerkUserId) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    const claims = auth.sessionClaims as Record<string, unknown> | undefined;
    const displayName =
      (typeof claims?.name === "string" && claims.name) ||
      (typeof claims?.first_name === "string" && claims.first_name) ||
      "AgroMarket member";
    const email = typeof claims?.email === "string" ? claims.email : "";

    const [inserted] = await db
      .insert(usersTable)
      .values({ clerkId: clerkUserId, displayName, email })
      .onConflictDoNothing({ target: usersTable.clerkId })
      .returning();
    const [user] = inserted
      ? [inserted]
      : await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.clerkId, clerkUserId))
          .limit(1);

    if (!user) {
      res.status(500).json({ error: "Could not load your marketplace account." });
      return;
    }

    await db
      .insert(userRolesTable)
      .values({ userId: user.id, role: "consumer" })
      .onConflictDoNothing();
    req.marketplaceUserId = user.id;
    req.clerkUserId = clerkUserId;
    next();
  } catch (error) {
    next(error);
  }
};

export function requireRole(...roles: MarketplaceRole[]): RequestHandler {
  return async (req, res, next) => {
    try {
      const userId = req.marketplaceUserId;
      if (userId === undefined) {
        res.status(401).json({ error: "Sign in to continue." });
        return;
      }
      const [role] = await db
        .select({ role: userRolesTable.role })
        .from(userRolesTable)
        .where(
          and(
            eq(userRolesTable.userId, userId),
            inArray(userRolesTable.role, roles),
          ),
        )
        .limit(1);
      if (!role) {
        res.status(403).json({ error: "Your account does not have access to this area." });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
