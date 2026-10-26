import { Router, type IRouter } from "express";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import {
  db,
  inventoryTable,
  orderStatusEnum,
  ordersTable,
  productsTable,
  sellerProfilesTable,
} from "@workspace/db";
import {
  GetSellerDashboardResponse,
  UpdateSellerOrderStatusBody,
  UpdateSellerOrderStatusParams,
  UpdateSellerOrderStatusResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { orderPayload } from "./commerce";

const router: IRouter = Router();
const activeOrderStatuses = ["paid", "processing", "in_transit"] as const;
type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["processing", "cancelled"],
  processing: ["in_transit", "cancelled"],
  in_transit: ["delivered"],
  delivered: [],
  cancelled: [],
};

router.get(
  "/seller/dashboard",
  requireAuth,
  requireRole("farmer", "supplier"),
  async (req, res): Promise<void> => {
    const [seller] = await db
      .select({ id: sellerProfilesTable.id })
      .from(sellerProfilesTable)
      .where(eq(sellerProfilesTable.userId, req.marketplaceUserId!))
      .limit(1);
    if (!seller) {
      res.status(409).json({ error: "Complete seller onboarding first." });
      return;
    }

    const [{ count: productCount }] = await db
      .select({ count: count(productsTable.id) })
      .from(productsTable)
      .where(eq(productsTable.sellerId, seller.id));
    const [{ count: activeOrders }] = await db
      .select({ count: count(ordersTable.id) })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.sellerId, seller.id),
          inArray(ordersTable.status, [...activeOrderStatuses]),
        ),
      );
    const [{ total: revenueNgn }] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${ordersTable.totalNgn}), 0)`,
      })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.sellerId, seller.id),
          inArray(ordersTable.paymentStatus, ["paid"]),
        ),
      );
    const [{ total: stockUnits }] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${inventoryTable.quantity} - ${inventoryTable.reserved}), 0)`,
      })
      .from(inventoryTable)
      .innerJoin(
        productsTable,
        eq(inventoryTable.productId, productsTable.id),
      )
      .where(eq(productsTable.sellerId, seller.id));
    const recent = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.sellerId, seller.id))
      .orderBy(desc(ordersTable.createdAt))
      .limit(5);
    const recentOrders = await Promise.all(
      recent.map((order) => orderPayload(order.id)),
    );
    res.json(
      GetSellerDashboardResponse.parse({
        productCount,
        activeOrders,
        revenueNgn: Number(revenueNgn),
        stockUnits: Number(stockUnits),
        recentOrders: recentOrders.filter((order) => order !== null),
      }),
    );
  },
);

router.patch(
  "/seller/orders/:id/status",
  requireAuth,
  requireRole("farmer", "supplier"),
  async (req, res): Promise<void> => {
    const params = UpdateSellerOrderStatusParams.safeParse(req.params);
    const parsed = UpdateSellerOrderStatusBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [seller] = await db
      .select({ id: sellerProfilesTable.id })
      .from(sellerProfilesTable)
      .where(eq(sellerProfilesTable.userId, req.marketplaceUserId!))
      .limit(1);
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.id, params.data.id),
          eq(ordersTable.sellerId, seller?.id ?? -1),
        ),
      )
      .limit(1);
    if (!order) {
      res.status(404).json({ error: "Order not found for this seller." });
      return;
    }
    if (!allowedTransitions[order.status].includes(parsed.data.status)) {
      res.status(409).json({
        error: `Cannot move an order from ${order.status} to ${parsed.data.status}.`,
      });
      return;
    }
    await db
      .update(ordersTable)
      .set({ status: parsed.data.status })
      .where(eq(ordersTable.id, order.id));
    const payload = await orderPayload(order.id);
    if (!payload) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    res.json(UpdateSellerOrderStatusResponse.parse(payload));
  },
);

export default router;
