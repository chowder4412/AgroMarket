import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  orderDisputesTable,
  ordersTable,
  sellerProfilesTable,
  usersTable,
} from "@workspace/db";
import {
  CreateOrderDisputeBody,
  CreateOrderDisputeParams,
  CreateOrderDisputeResponse,
  ListAdminDisputesResponse,
  ListBuyerDisputesResponse,
  UpdateOrderDisputeBody,
  UpdateOrderDisputeParams,
  UpdateOrderDisputeResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { canTransitionDispute } from "../lib/dispute-state";

const router: IRouter = Router();
const adminOnly = [requireAuth, requireRole("admin")];

async function disputePayload(id: number) {
  const [dispute] = await db
    .select({
      id: orderDisputesTable.id,
      orderId: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      sellerName: sellerProfilesTable.businessName,
      buyerName: usersTable.displayName,
      reason: orderDisputesTable.reason,
      details: orderDisputesTable.details,
      status: orderDisputesTable.status,
      resolutionNote: orderDisputesTable.resolutionNote,
      createdAt: orderDisputesTable.createdAt,
    })
    .from(orderDisputesTable)
    .innerJoin(ordersTable, eq(orderDisputesTable.orderId, ordersTable.id))
    .innerJoin(sellerProfilesTable, eq(orderDisputesTable.sellerId, sellerProfilesTable.id))
    .innerJoin(usersTable, eq(orderDisputesTable.buyerId, usersTable.id))
    .where(eq(orderDisputesTable.id, id))
    .limit(1);
  return dispute ?? null;
}

router.get("/orders/disputes", requireAuth, async (req, res): Promise<void> => {
  const disputes = await db
    .select({ id: orderDisputesTable.id })
    .from(orderDisputesTable)
    .where(eq(orderDisputesTable.buyerId, req.marketplaceUserId!))
    .orderBy(desc(orderDisputesTable.createdAt));
  const payloads = await Promise.all(disputes.map(({ id }) => disputePayload(id)));
  res.json(ListBuyerDisputesResponse.parse(payloads.filter(Boolean)));
});

router.post(
  "/orders/:id/disputes",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = CreateOrderDisputeParams.safeParse(req.params);
    const parsed = CreateOrderDisputeBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [order] = await db
      .select({
        id: ordersTable.id,
        sellerId: ordersTable.sellerId,
        paymentStatus: ordersTable.paymentStatus,
        status: ordersTable.status,
      })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.id, params.data.id),
          eq(ordersTable.buyerId, req.marketplaceUserId!),
        ),
      )
      .limit(1);
    if (!order || order.paymentStatus !== "paid" || order.status === "cancelled") {
      res.status(404).json({ error: "Eligible order not found." });
      return;
    }
    const [created] = await db
      .insert(orderDisputesTable)
      .values({
        orderId: order.id,
        buyerId: req.marketplaceUserId!,
        sellerId: order.sellerId,
        reason: parsed.data.reason,
        details: parsed.data.details,
      })
      .onConflictDoNothing()
      .returning({ id: orderDisputesTable.id });
    if (!created) {
      res.status(409).json({ error: "A dispute already exists for this order." });
      return;
    }
    const payload = await disputePayload(created.id);
    res.status(201).json(CreateOrderDisputeResponse.parse(payload));
  },
);

router.get(
  "/admin/disputes",
  ...adminOnly,
  async (_req, res): Promise<void> => {
    const disputes = await db
      .select({ id: orderDisputesTable.id })
      .from(orderDisputesTable)
      .orderBy(desc(orderDisputesTable.createdAt));
    const payloads = await Promise.all(disputes.map(({ id }) => disputePayload(id)));
    res.json(ListAdminDisputesResponse.parse(payloads.filter(Boolean)));
  },
);

router.patch(
  "/admin/disputes/:id",
  ...adminOnly,
  async (req, res): Promise<void> => {
    const params = UpdateOrderDisputeParams.safeParse(req.params);
    const parsed = UpdateOrderDisputeBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (
      (parsed.data.status === "resolved" || parsed.data.status === "rejected") &&
      !parsed.data.resolutionNote.trim()
    ) {
      res.status(400).json({ error: "Add a resolution note before closing a dispute." });
      return;
    }
    const [dispute] = await db
      .select()
      .from(orderDisputesTable)
      .where(eq(orderDisputesTable.id, params.data.id))
      .limit(1);
    if (!dispute) {
      res.status(404).json({ error: "Dispute not found." });
      return;
    }
    if (!canTransitionDispute(dispute.status, parsed.data.status)) {
      res.status(409).json({ error: `Cannot move a ${dispute.status} dispute to ${parsed.data.status}.` });
      return;
    }
    await db
      .update(orderDisputesTable)
      .set({
        status: parsed.data.status,
        resolutionNote: parsed.data.resolutionNote,
        updatedAt: new Date(),
      })
      .where(eq(orderDisputesTable.id, dispute.id));
    const payload = await disputePayload(dispute.id);
    res.json(UpdateOrderDisputeResponse.parse(payload));
  },
);

export default router;