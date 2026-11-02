import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  checkoutPaymentsTable,
  db,
  inventoryTable,
  orderItemsTable,
  ordersTable,
  paymentsTable,
  productsTable,
  quotationItemsTable,
  quotationResponseItemsTable,
  quotationResponsesTable,
  quotationsTable,
  sellerProfilesTable,
} from "@workspace/db";
import {
  CreateQuotationBody,
  CreateQuotationResponse,
  ListQuotationsResponse,
  ListSellerQuotationsResponse,
  RespondToQuotationBody,
  RespondToQuotationParams,
  RespondToQuotationResponse,
  UpdateQuotationResponseBody,
  UpdateQuotationResponseParams,
  UpdateQuotationResponseResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { initializePaystackTransaction, isPaystackConfigured, markPaystackPaymentFailed } from "../lib/paystack";
import { calculateQuotationPrice } from "../lib/quotation-pricing";
import { orderPayload } from "./commerce";

const router: IRouter = Router();
class QuoteStockChangedError extends Error {}

async function quotationPayload(id: number, sellerId?: number) {
  const [quotation] = await db
    .select()
    .from(quotationsTable)
    .where(eq(quotationsTable.id, id))
    .limit(1);
  if (!quotation) return null;
  const items = await db
    .select({
      quotationItemId: quotationItemsTable.id,
      productId: productsTable.id,
      name: productsTable.name,
      unit: productsTable.unit,
      unitPrice: productsTable.priceNgn,
      quantity: quotationItemsTable.quantity,
      sellerName: sellerProfilesTable.businessName,
      sellerId: sellerProfilesTable.id,
    })
    .from(quotationItemsTable)
    .innerJoin(productsTable, eq(quotationItemsTable.productId, productsTable.id))
    .innerJoin(
      sellerProfilesTable,
      eq(productsTable.sellerId, sellerProfilesTable.id),
    )
    .where(eq(quotationItemsTable.quotationId, id));
  const responses = await db
    .select({
      id: quotationResponsesTable.id,
      sellerId: sellerProfilesTable.id,
      sellerName: sellerProfilesTable.businessName,
      status: quotationResponsesTable.status,
      totalNgn: quotationResponsesTable.totalNgn,
      message: quotationResponsesTable.message,
      createdAt: quotationResponsesTable.createdAt,
    })
    .from(quotationResponsesTable)
    .innerJoin(
      sellerProfilesTable,
      eq(quotationResponsesTable.sellerId, sellerProfilesTable.id),
    )
    .where(eq(quotationResponsesTable.quotationId, id));
  const responseItems = responses.length
    ? await db
        .select({
          responseId: quotationResponseItemsTable.responseId,
          quotationItemId: quotationItemsTable.id,
          unitPriceNgn: quotationResponseItemsTable.unitPriceNgn,
          quantity: quotationItemsTable.quantity,
          name: productsTable.name,
          unit: productsTable.unit,
        })
        .from(quotationResponseItemsTable)
        .innerJoin(
          quotationItemsTable,
          eq(quotationResponseItemsTable.quotationItemId, quotationItemsTable.id),
        )
        .innerJoin(productsTable, eq(quotationItemsTable.productId, productsTable.id))
        .where(inArray(quotationResponseItemsTable.responseId, responses.map((response) => response.id)))
    : [];
  const responseItemsById = new Map<number, typeof responseItems>();
  for (const item of responseItems) {
    const itemsForResponse = responseItemsById.get(item.responseId) ?? [];
    itemsForResponse.push(item);
    responseItemsById.set(item.responseId, itemsForResponse);
  }
  return {
    id: quotation.id,
    businessName: quotation.businessName,
    status: quotation.status,
    notes: quotation.notes,
    createdAt: quotation.createdAt,
    items: items
      .filter((item) => sellerId === undefined || item.sellerId === sellerId)
      .map(({ sellerId: _sellerId, ...item }) => item),
    responses: responses
      .filter((response) => sellerId === undefined || response.sellerId === sellerId)
      .map(({ sellerId: _sellerId, ...response }) => ({
        ...response,
        items: (responseItemsById.get(response.id) ?? []).map(
          ({ responseId: _responseId, ...item }) => item,
        ),
      })),
  };
}

router.get(
  "/quotations",
  requireAuth,
  requireRole("business_buyer"),
  async (req, res): Promise<void> => {
    const quotations = await db
      .select({ id: quotationsTable.id })
      .from(quotationsTable)
      .where(eq(quotationsTable.buyerId, req.marketplaceUserId!))
      .orderBy(asc(quotationsTable.createdAt));
    const payloads = await Promise.all(
      quotations.map((quotation) => quotationPayload(quotation.id)),
    );
    res.json(ListQuotationsResponse.parse(payloads.filter(Boolean)));
  },
);

router.get(
  "/seller/quotations",
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
    const quoteRows = await db
      .selectDistinct({ id: quotationsTable.id })
      .from(quotationItemsTable)
      .innerJoin(productsTable, eq(quotationItemsTable.productId, productsTable.id))
      .innerJoin(quotationsTable, eq(quotationItemsTable.quotationId, quotationsTable.id))
      .where(eq(productsTable.sellerId, seller.id));
    const payloads = await Promise.all(
      quoteRows.map((quote) => quotationPayload(quote.id, seller.id)),
    );
    res.json(ListSellerQuotationsResponse.parse(payloads.filter(Boolean)));
  },
);

router.post(
  "/quotations",
  requireAuth,
  requireRole("business_buyer"),
  async (req, res): Promise<void> => {
    const parsed = CreateQuotationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const productIds = parsed.data.items.map((item) => item.productId);
    const products = await db
      .select({ id: productsTable.id, status: productsTable.status })
      .from(productsTable)
      .where(
        and(
          inArray(productsTable.id, productIds),
          eq(productsTable.status, "active"),
        ),
      );
    if (products.length !== new Set(productIds).size) {
      res.status(400).json({ error: "One or more listed products are unavailable." });
      return;
    }

    const [quotation] = await db
      .insert(quotationsTable)
      .values({
        buyerId: req.marketplaceUserId!,
        businessName: parsed.data.businessName,
        notes: parsed.data.notes,
      })
      .returning({ id: quotationsTable.id });
    await db.insert(quotationItemsTable).values(
      parsed.data.items.map((item) => ({
        quotationId: quotation.id,
        productId: item.productId,
        quantity: item.quantity,
      })),
    );
    const response = await quotationPayload(quotation.id);
    if (!response) {
      res.status(500).json({ error: "Could not create quotation." });
      return;
    }
    res.status(201).json(CreateQuotationResponse.parse(response));
  },
);

router.post(
  "/seller/quotations/:id/response",
  requireAuth,
  requireRole("farmer", "supplier"),
  async (req, res): Promise<void> => {
    const params = RespondToQuotationParams.safeParse(req.params);
    const parsed = RespondToQuotationBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [seller] = await db
      .select()
      .from(sellerProfilesTable)
      .where(eq(sellerProfilesTable.userId, req.marketplaceUserId!))
      .limit(1);
    if (!seller) {
      res.status(409).json({ error: "Complete seller onboarding first." });
      return;
    }
    const [quotation] = await db
      .select()
      .from(quotationsTable)
      .where(eq(quotationsTable.id, params.data.id))
      .limit(1);
    if (!quotation || quotation.status === "accepted" || quotation.status === "declined") {
      res.status(404).json({ error: "Open quote request not found." });
      return;
    }
    const eligibleItems = await db
      .select({ quotationItemId: quotationItemsTable.id, quantity: quotationItemsTable.quantity })
      .from(quotationItemsTable)
      .innerJoin(productsTable, eq(quotationItemsTable.productId, productsTable.id))
      .where(
        and(
          eq(quotationItemsTable.quotationId, quotation.id),
          eq(productsTable.sellerId, seller.id),
        ),
      );
    if (!eligibleItems.length) {
      res.status(404).json({ error: "This request contains no products from your shop." });
      return;
    }
    let pricedItems: ReturnType<typeof calculateQuotationPrice>["items"] = [];
    let totalNgn: number | null = null;
    if (parsed.data.status === "quoted") {
      try {
        const pricing = calculateQuotationPrice(eligibleItems, parsed.data.items ?? []);
        pricedItems = pricing.items;
        totalNgn = pricing.totalNgn;
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid quote prices." });
        return;
      }
    }
    const response = await db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(quotationResponsesTable)
        .values({
          quotationId: quotation.id,
          sellerId: seller.id,
          status: parsed.data.status,
          totalNgn,
          message: parsed.data.message,
        })
        .onConflictDoUpdate({
          target: [quotationResponsesTable.quotationId, quotationResponsesTable.sellerId],
          set: {
            status: parsed.data.status,
            totalNgn,
            message: parsed.data.message,
            updatedAt: new Date(),
          },
        })
        .returning();
      await tx
        .delete(quotationResponseItemsTable)
        .where(eq(quotationResponseItemsTable.responseId, saved.id));
      if (pricedItems.length) {
        await tx.insert(quotationResponseItemsTable).values(
          pricedItems.map((item) => ({
            responseId: saved.id,
            quotationItemId: item.quotationItemId,
            unitPriceNgn: item.unitPriceNgn,
          })),
        );
      }
      await tx
        .update(quotationsTable)
        .set({ status: parsed.data.status === "quoted" ? "quoted" : quotation.status })
        .where(eq(quotationsTable.id, quotation.id));
      return saved;
    });
    const updated = await quotationPayload(quotation.id, seller.id);
    const responsePayload = updated?.responses.find((item) => item.id === response.id);
    res.json(
      RespondToQuotationResponse.parse(responsePayload),
    );
  },
);

router.patch(
  "/quotations/:id/responses/:responseId",
  requireAuth,
  requireRole("business_buyer"),
  async (req, res): Promise<void> => {
    const params = UpdateQuotationResponseParams.safeParse(req.params);
    const parsed = UpdateQuotationResponseBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [quotation] = await db
      .select()
      .from(quotationsTable)
      .where(
        and(
          eq(quotationsTable.id, params.data.id),
          eq(quotationsTable.buyerId, req.marketplaceUserId!),
        ),
      )
      .limit(1);
    if (!quotation || quotation.status === "accepted" || quotation.status === "declined") {
      res.status(404).json({ error: "Open quote request not found." });
      return;
    }
    const [response] = await db
      .select()
      .from(quotationResponsesTable)
      .where(
        and(
          eq(quotationResponsesTable.id, params.data.responseId),
          eq(quotationResponsesTable.quotationId, quotation.id),
        ),
      )
      .limit(1);
    if (!response || response.status !== "quoted") {
      res.status(404).json({ error: "Quote response not found." });
      return;
    }
    if (parsed.data.status === "accepted") {
      const deliveryAddress = parsed.data.deliveryAddress?.trim();
      const paymentMode = parsed.data.paymentMode;
      const email = parsed.data.email?.trim();
      if (!deliveryAddress || !paymentMode) {
        res.status(400).json({ error: "Delivery address and payment method are required to accept a quote." });
        return;
      }
      if (paymentMode === "paystack" && !email) {
        res.status(400).json({ error: "An email address is required for Paystack checkout." });
        return;
      }
      if (paymentMode === "paystack" && !isPaystackConfigured()) {
        res.status(503).json({ error: "Paystack is not configured." });
        return;
      }

      const groupNumber = `AM-${randomUUID().slice(0, 8).toUpperCase()}`;
      const reference = `AMPS-${randomUUID()}`;
      let acceptedOrder: { id: number; totalNgn: number };
      try {
        acceptedOrder = await db.transaction(async (tx) => {
          const [lockedQuotation] = await tx
            .select()
            .from(quotationsTable)
            .where(
              and(
                eq(quotationsTable.id, quotation.id),
                eq(quotationsTable.buyerId, req.marketplaceUserId!),
              ),
            )
            .for("update")
            .limit(1);
          if (!lockedQuotation || lockedQuotation.status === "accepted" || lockedQuotation.status === "declined") {
            throw new Error("This quote request has already been closed.");
          }
          const [lockedResponse] = await tx
            .select()
            .from(quotationResponsesTable)
            .where(
              and(
                eq(quotationResponsesTable.id, response.id),
                eq(quotationResponsesTable.quotationId, quotation.id),
                eq(quotationResponsesTable.status, "quoted"),
              ),
            )
            .for("update")
            .limit(1);
          if (!lockedResponse) throw new Error("This quote is no longer available.");

          const requestedItems = await tx
            .select({
              quotationItemId: quotationItemsTable.id,
              quantity: quotationItemsTable.quantity,
              productId: productsTable.id,
              name: productsTable.name,
              unit: productsTable.unit,
              status: productsTable.status,
              sellerId: productsTable.sellerId,
            })
            .from(quotationItemsTable)
            .innerJoin(productsTable, eq(quotationItemsTable.productId, productsTable.id))
            .where(
              and(
                eq(quotationItemsTable.quotationId, quotation.id),
                eq(productsTable.sellerId, lockedResponse.sellerId),
              ),
            );
          const proposedPrices = await tx
            .select({
              quotationItemId: quotationResponseItemsTable.quotationItemId,
              unitPriceNgn: quotationResponseItemsTable.unitPriceNgn,
            })
            .from(quotationResponseItemsTable)
            .where(eq(quotationResponseItemsTable.responseId, lockedResponse.id));
          const pricing = calculateQuotationPrice(requestedItems, proposedPrices);
          if (requestedItems.some((item) => item.status !== "active")) {
            throw new QuoteStockChangedError("A quoted product is no longer available.");
          }

          for (const item of pricing.items) {
            const requested = requestedItems.find(
              (entry) => entry.quotationItemId === item.quotationItemId,
            );
            if (!requested) throw new Error("Quoted order items no longer match the request.");
            const [inventory] = await tx
              .update(inventoryTable)
              .set(
                paymentMode === "paystack"
                  ? { reserved: sql`${inventoryTable.reserved} + ${item.quantity}` }
                  : { quantity: sql`${inventoryTable.quantity} - ${item.quantity}` },
              )
              .where(
                and(
                  eq(inventoryTable.productId, requested.productId),
                  sql`${inventoryTable.quantity} - ${inventoryTable.reserved} >= ${item.quantity}`,
                ),
              )
              .returning({ productId: inventoryTable.productId });
            if (!inventory) throw new QuoteStockChangedError("Stock changed while accepting the quote.");
          }

          const [createdOrder] = await tx
            .insert(ordersTable)
            .values({
              orderNumber: `${groupNumber}-01`,
              orderGroupNumber: groupNumber,
              sellerId: lockedResponse.sellerId,
              buyerId: req.marketplaceUserId!,
              status: paymentMode === "sandbox" ? "paid" : "pending_payment",
              paymentStatus: paymentMode === "sandbox" ? "paid" : "pending",
              paymentMode: paymentMode === "sandbox" ? "sandbox" : "provider_pending",
              totalNgn: pricing.totalNgn,
              deliveryAddress,
            })
            .returning({ id: ordersTable.id });
          await tx.insert(orderItemsTable).values(
            pricing.items.map((item) => {
              const requested = requestedItems.find(
                (entry) => entry.quotationItemId === item.quotationItemId,
              )!;
              return {
                orderId: createdOrder.id,
                productId: requested.productId,
                sellerId: lockedResponse.sellerId,
                productName: requested.name,
                unit: requested.unit,
                unitPriceNgn: item.unitPriceNgn,
                quantity: item.quantity,
              };
            }),
          );
          await tx.insert(paymentsTable).values({
            orderId: createdOrder.id,
            provider: paymentMode === "sandbox" ? "sandbox" : "paystack",
            status: paymentMode === "sandbox" ? "paid" : "pending",
            amountNgn: pricing.totalNgn,
            providerReference: paymentMode === "sandbox" ? groupNumber : `${reference}-01`,
          });
          if (paymentMode === "paystack") {
            await tx.insert(checkoutPaymentsTable).values({
              orderGroupNumber: groupNumber,
              buyerId: req.marketplaceUserId!,
              provider: "paystack",
              status: "pending",
              amountNgn: pricing.totalNgn,
              providerReference: reference,
              quotationResponseId: lockedResponse.id,
              expiresAt: new Date(Date.now() + 15 * 60_000),
            });
          }
          await tx
            .update(quotationResponsesTable)
            .set({ status: "accepted", updatedAt: new Date() })
            .where(eq(quotationResponsesTable.id, lockedResponse.id));
          await tx
            .update(quotationResponsesTable)
            .set({ status: "declined", updatedAt: new Date() })
            .where(
              and(
                eq(quotationResponsesTable.quotationId, quotation.id),
                ne(quotationResponsesTable.id, lockedResponse.id),
                eq(quotationResponsesTable.status, "quoted"),
              ),
            );
          await tx
            .update(quotationsTable)
            .set({ status: "accepted" })
            .where(eq(quotationsTable.id, quotation.id));
          return { id: createdOrder.id, totalNgn: pricing.totalNgn };
        });
      } catch (error) {
        if (error instanceof QuoteStockChangedError) {
          res.status(409).json({ error: error.message });
          return;
        }
        if (error instanceof Error && error.message === "This quote request has already been closed.") {
          res.status(409).json({ error: error.message });
          return;
        }
        if (error instanceof Error && error.message === "This quote is no longer available.") {
          res.status(409).json({ error: error.message });
          return;
        }
        throw error;
      }

      let authorizationUrl: string | null = null;
      if (paymentMode === "paystack") {
        try {
          const initialized = await initializePaystackTransaction({
            email: email!,
            amountNgn: acceptedOrder.totalNgn,
            reference,
            orderGroupNumber: groupNumber,
          });
          authorizationUrl = initialized.authorizationUrl;
          await db
            .update(checkoutPaymentsTable)
            .set({ authorizationUrl })
            .where(eq(checkoutPaymentsTable.providerReference, reference));
        } catch {
          await markPaystackPaymentFailed(reference, `initialize-failed:${groupNumber}`);
          res.status(502).json({ error: "Paystack could not start this payment. The order was cancelled and reserved stock released." });
          return;
        }
      }
      const updatedQuotation = await quotationPayload(quotation.id);
      const order = await orderPayload(acceptedOrder.id);
      res.json(
        UpdateQuotationResponseResponse.parse({
          quotation: updatedQuotation,
          orderGroupNumber: groupNumber,
          status: paymentMode === "sandbox" ? "paid" : "pending",
          authorizationUrl,
          orders: order ? [order] : [],
        }),
      );
      return;
    }
    await db.transaction(async (tx) => {
      await tx
        .update(quotationResponsesTable)
        .set({ status: "declined", updatedAt: new Date() })
        .where(eq(quotationResponsesTable.id, response.id));
      const sellers = await tx
        .selectDistinct({ sellerId: productsTable.sellerId })
        .from(quotationItemsTable)
        .innerJoin(productsTable, eq(quotationItemsTable.productId, productsTable.id))
        .where(eq(quotationItemsTable.quotationId, quotation.id));
      const responses = await tx
        .select({ status: quotationResponsesTable.status })
        .from(quotationResponsesTable)
        .where(eq(quotationResponsesTable.quotationId, quotation.id));
      const stillQuoted = responses.some((entry) => entry.status === "quoted");
      const allSellersResponded = responses.length >= sellers.length;
      await tx
        .update(quotationsTable)
        .set({
          status: stillQuoted
            ? "quoted"
            : allSellersResponded
              ? "declined"
              : quotation.status === "quoted"
                ? "quoted"
                : "requested",
        })
        .where(eq(quotationsTable.id, quotation.id));
    });
    const updated = await quotationPayload(quotation.id);
    res.json(
      UpdateQuotationResponseResponse.parse({
        quotation: updated,
        orderGroupNumber: null,
        status: null,
        authorizationUrl: null,
        orders: [],
      }),
    );
  },
);

export default router;
