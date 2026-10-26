import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  and,
  asc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import {
  cartsTable,
  cartItemsTable,
  db,
  inventoryTable,
  orderItemsTable,
  ordersTable,
  paymentsTable,
  productWholesaleTiersTable,
  productsTable,
  sellerProfilesTable,
} from "@workspace/db";
import {
  AddCartItemBody,
  AddCartItemResponse,
  CheckoutBody,
  CheckoutResponse,
  GetCartResponse,
  ListOrdersResponse,
  RemoveCartItemParams,
  RemoveCartItemResponse,
  UpdateCartItemBody,
  UpdateCartItemParams,
  UpdateCartItemResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

class StockChangedError extends Error {}

async function ensureCart(userId: number) {
  await db
    .insert(cartsTable)
    .values({ userId })
    .onConflictDoNothing({ target: cartsTable.userId });
  const [cart] = await db
    .select()
    .from(cartsTable)
    .where(eq(cartsTable.userId, userId))
    .limit(1);
  if (!cart) throw new Error("Cart could not be initialized.");
  return cart;
}

async function getCartPayload(userId: number) {
  const cart = await ensureCart(userId);
  const rows = await db
    .select({
      id: cartItemsTable.id,
      productId: productsTable.id,
      name: productsTable.name,
      imageUrl: productsTable.imageUrl,
      unit: productsTable.unit,
      basePrice: productsTable.priceNgn,
      quantity: cartItemsTable.quantity,
      minOrder: productsTable.minOrder,
      stock: inventoryTable.quantity,
      reserved: inventoryTable.reserved,
      sellerName: sellerProfilesTable.businessName,
      sellerId: sellerProfilesTable.id,
    })
    .from(cartItemsTable)
    .innerJoin(productsTable, eq(cartItemsTable.productId, productsTable.id))
    .innerJoin(
      sellerProfilesTable,
      eq(productsTable.sellerId, sellerProfilesTable.id),
    )
    .leftJoin(inventoryTable, eq(productsTable.id, inventoryTable.productId))
    .where(eq(cartItemsTable.cartId, cart.id));

  const productIds = rows.map((row) => row.productId);
  const tiers = productIds.length
    ? await db
        .select({
          productId: productWholesaleTiersTable.productId,
          minQuantity: productWholesaleTiersTable.minQuantity,
          unitPriceNgn: productWholesaleTiersTable.unitPriceNgn,
        })
        .from(productWholesaleTiersTable)
        .where(inArray(productWholesaleTiersTable.productId, productIds))
        .orderBy(asc(productWholesaleTiersTable.minQuantity))
    : [];

  const items = rows.map((row) => {
    const productTiers = tiers.filter(
      (tier) => tier.productId === row.productId,
    );
    const applicable = productTiers.filter(
      (tier) => tier.minQuantity <= row.quantity,
    );
    const unitPrice =
      applicable.at(-1)?.unitPriceNgn ?? row.basePrice;
    return {
      id: row.id,
      productId: row.productId,
      name: row.name,
      imageUrl: row.imageUrl,
      unit: row.unit,
      unitPrice,
      quantity: row.quantity,
      stock: Math.max(0, (row.stock ?? 0) - (row.reserved ?? 0)),
      sellerName: row.sellerName,
      sellerId: row.sellerId,
      minOrder: row.minOrder,
    };
  });

  return {
    cart: GetCartResponse.parse({
      items: items.map(({ sellerId: _sellerId, minOrder: _minOrder, ...item }) => item),
      sellerCount: new Set(items.map((item) => item.sellerId)).size,
      subtotal: items.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0,
      ),
    }),
    items,
    cartId: cart.id,
  };
}

export async function orderPayload(orderId: number) {
  const [order] = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      sellerName: sellerProfilesTable.businessName,
      status: ordersTable.status,
      paymentStatus: ordersTable.paymentStatus,
      paymentMode: ordersTable.paymentMode,
      total: ordersTable.totalNgn,
      deliveryAddress: ordersTable.deliveryAddress,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .innerJoin(
      sellerProfilesTable,
      eq(ordersTable.sellerId, sellerProfilesTable.id),
    )
    .where(eq(ordersTable.id, orderId))
    .limit(1);
  if (!order) return null;

  const items = await db
    .select({
      productId: orderItemsTable.productId,
      name: orderItemsTable.productName,
      unit: orderItemsTable.unit,
      unitPrice: orderItemsTable.unitPriceNgn,
      quantity: orderItemsTable.quantity,
      sellerName: sellerProfilesTable.businessName,
    })
    .from(orderItemsTable)
    .innerJoin(
      sellerProfilesTable,
      eq(orderItemsTable.sellerId, sellerProfilesTable.id),
    )
    .where(eq(orderItemsTable.orderId, orderId));

  return { ...order, items };
}

router.get("/cart", requireAuth, async (req, res): Promise<void> => {
  const { cart } = await getCartPayload(req.marketplaceUserId!);
  res.json(cart);
});

router.post(
  "/cart/items",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = AddCartItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [product] = await db
      .select({
        id: productsTable.id,
        minOrder: productsTable.minOrder,
        status: productsTable.status,
        stock: inventoryTable.quantity,
        reserved: inventoryTable.reserved,
      })
      .from(productsTable)
      .leftJoin(inventoryTable, eq(productsTable.id, inventoryTable.productId))
      .where(eq(productsTable.id, parsed.data.productId))
      .limit(1);
    if (!product || product.status !== "active") {
      res.status(404).json({ error: "Product is not available." });
      return;
    }
    const available = Math.max(
      0,
      (product.stock ?? 0) - (product.reserved ?? 0),
    );
    if (
      parsed.data.quantity < product.minOrder ||
      parsed.data.quantity > available
    ) {
      res.status(409).json({
        error: `Minimum order is ${product.minOrder}; available stock is ${available}.`,
      });
      return;
    }

    const cart = await ensureCart(req.marketplaceUserId!);
    const [existing] = await db
      .select()
      .from(cartItemsTable)
      .where(
        and(
          eq(cartItemsTable.cartId, cart.id),
          eq(cartItemsTable.productId, product.id),
        ),
      )
      .limit(1);
    const nextQuantity = (existing?.quantity ?? 0) + parsed.data.quantity;
    if (nextQuantity > available) {
      res.status(409).json({ error: "The requested quantity exceeds available stock." });
      return;
    }
    if (existing) {
      await db
        .update(cartItemsTable)
        .set({ quantity: nextQuantity })
        .where(eq(cartItemsTable.id, existing.id));
    } else {
      await db.insert(cartItemsTable).values({
        cartId: cart.id,
        productId: product.id,
        quantity: parsed.data.quantity,
      });
    }
    const { cart: updated } = await getCartPayload(req.marketplaceUserId!);
    res.status(201).json(AddCartItemResponse.parse(updated));
  },
);

router.patch(
  "/cart/items/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateCartItemParams.safeParse(req.params);
    const parsed = UpdateCartItemBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { items } = await getCartPayload(req.marketplaceUserId!);
    const item = items.find((entry) => entry.id === params.data.id);
    if (!item) {
      res.status(404).json({ error: "Cart item not found." });
      return;
    }
    if (parsed.data.quantity < item.minOrder || parsed.data.quantity > item.stock) {
      res.status(409).json({
        error: `Minimum order is ${item.minOrder}; available stock is ${item.stock}.`,
      });
      return;
    }
    await db
      .update(cartItemsTable)
      .set({ quantity: parsed.data.quantity })
      .where(eq(cartItemsTable.id, item.id));
    const { cart } = await getCartPayload(req.marketplaceUserId!);
    res.json(UpdateCartItemResponse.parse(cart));
  },
);

router.delete(
  "/cart/items/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = RemoveCartItemParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const cart = await ensureCart(req.marketplaceUserId!);
    await db
      .delete(cartItemsTable)
      .where(
        and(
          eq(cartItemsTable.id, params.data.id),
          eq(cartItemsTable.cartId, cart.id),
        ),
      );
    const { cart: updated } = await getCartPayload(req.marketplaceUserId!);
    res.json(RemoveCartItemResponse.parse(updated));
  },
);

router.post(
  "/checkout",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = CheckoutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.paymentMode !== "sandbox") {
      res.status(503).json({
        error: "Live payment processing is not configured. Choose sandbox checkout.",
      });
      return;
    }

    const userId = req.marketplaceUserId!;
    const groupNumber = `AM-${randomUUID().slice(0, 8).toUpperCase()}`;
    try {
      const cart = await ensureCart(userId);
      const orderIds = await db.transaction(async (tx) => {
        const rows = await tx
          .select({
            cartItemId: cartItemsTable.id,
            productId: productsTable.id,
            sellerId: productsTable.sellerId,
            name: productsTable.name,
            unit: productsTable.unit,
            price: productsTable.priceNgn,
            minOrder: productsTable.minOrder,
            quantity: cartItemsTable.quantity,
            status: productsTable.status,
            stock: inventoryTable.quantity,
            reserved: inventoryTable.reserved,
          })
          .from(cartItemsTable)
          .innerJoin(productsTable, eq(cartItemsTable.productId, productsTable.id))
          .innerJoin(
            inventoryTable,
            eq(productsTable.id, inventoryTable.productId),
          )
          .where(eq(cartItemsTable.cartId, cart.id));
        if (!rows.length) throw new Error("Your cart is empty.");

        const productIds = rows.map((row) => row.productId);
        const tiers = await tx
          .select({
            productId: productWholesaleTiersTable.productId,
            minQuantity: productWholesaleTiersTable.minQuantity,
            unitPriceNgn: productWholesaleTiersTable.unitPriceNgn,
          })
          .from(productWholesaleTiersTable)
          .where(inArray(productWholesaleTiersTable.productId, productIds))
          .orderBy(asc(productWholesaleTiersTable.minQuantity));

        const groups = new Map<number, typeof rows>();
        for (const row of rows) {
          if (row.status !== "active" || row.quantity < row.minOrder) {
            throw new StockChangedError("A product is no longer available in that quantity.");
          }
          const [updatedInventory] = await tx
            .update(inventoryTable)
            .set({
              quantity: sql`${inventoryTable.quantity} - ${row.quantity}`,
            })
            .where(
              and(
                eq(inventoryTable.productId, row.productId),
                sql`${inventoryTable.quantity} - ${inventoryTable.reserved} >= ${row.quantity}`,
              ),
            )
            .returning({ productId: inventoryTable.productId });
          if (!updatedInventory) {
            throw new StockChangedError(
              "Stock changed while checking out. Review your cart and try again.",
            );
          }
          const group = groups.get(row.sellerId) ?? [];
          group.push(row);
          groups.set(row.sellerId, group);
        }

        const createdOrderIds: number[] = [];
        let sellerIndex = 1;
        for (const [sellerId, sellerRows] of groups) {
          const lines = sellerRows.map((row) => {
            const applicable = tiers
              .filter(
                (tier) =>
                  tier.productId === row.productId &&
                  tier.minQuantity <= row.quantity,
              )
              .at(-1);
            return {
              ...row,
              unitPrice: applicable?.unitPriceNgn ?? row.price,
            };
          });
          const total = lines.reduce(
            (sum, line) => sum + line.unitPrice * line.quantity,
            0,
          );
          const [order] = await tx
            .insert(ordersTable)
            .values({
              orderNumber: `${groupNumber}-${String(sellerIndex).padStart(2, "0")}`,
              sellerId,
              buyerId: userId,
              status: "paid",
              paymentStatus: "paid",
              paymentMode: "sandbox",
              totalNgn: total,
              deliveryAddress: parsed.data.deliveryAddress,
            })
            .returning({ id: ordersTable.id });
          await tx.insert(orderItemsTable).values(
            lines.map((line) => ({
              orderId: order.id,
              productId: line.productId,
              sellerId,
              productName: line.name,
              unit: line.unit,
              unitPriceNgn: line.unitPrice,
              quantity: line.quantity,
            })),
          );
          await tx.insert(paymentsTable).values({
            orderId: order.id,
            provider: "sandbox",
            status: "paid",
            amountNgn: total,
            providerReference: `${groupNumber}-${sellerIndex}`,
          });
          createdOrderIds.push(order.id);
          sellerIndex += 1;
        }
        await tx.delete(cartItemsTable).where(eq(cartItemsTable.cartId, cart.id));
        return createdOrderIds;
      });

      const orders = await Promise.all(orderIds.map(orderPayload));
      const validOrders = orders.filter((order) => order !== null);
      const result = CheckoutResponse.parse({
        orderGroupNumber: groupNumber,
        grandTotal: validOrders.reduce((sum, order) => sum + order.total, 0),
        orders: validOrders,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof StockChangedError) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message === "Your cart is empty.") {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

router.get("/orders", requireAuth, async (req, res): Promise<void> => {
  const orders = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(eq(ordersTable.buyerId, req.marketplaceUserId!))
    .orderBy(sql`${ordersTable.createdAt} DESC`);
  const payloads = await Promise.all(orders.map((order) => orderPayload(order.id)));
  res.json(ListOrdersResponse.parse(payloads.filter((order) => order !== null)));
});

export default router;
