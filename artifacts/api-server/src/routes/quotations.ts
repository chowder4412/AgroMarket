import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  productsTable,
  quotationItemsTable,
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

const router: IRouter = Router();

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
      .map(({ sellerId: _sellerId, ...response }) => response),
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
    if (parsed.data.status === "quoted" && (!parsed.data.totalNgn || parsed.data.totalNgn < 1)) {
      res.status(400).json({ error: "A positive quote total is required." });
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
      .select({ id: quotationItemsTable.id })
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

    const [response] = await db
      .insert(quotationResponsesTable)
      .values({
        quotationId: quotation.id,
        sellerId: seller.id,
        status: parsed.data.status,
        totalNgn: parsed.data.status === "quoted" ? parsed.data.totalNgn! : null,
        message: parsed.data.message,
      })
      .onConflictDoUpdate({
        target: [quotationResponsesTable.quotationId, quotationResponsesTable.sellerId],
        set: {
          status: parsed.data.status,
          totalNgn: parsed.data.status === "quoted" ? parsed.data.totalNgn! : null,
          message: parsed.data.message,
          updatedAt: new Date(),
        },
      })
      .returning();
    await db
      .update(quotationsTable)
      .set({ status: parsed.data.status === "quoted" ? "quoted" : quotation.status })
      .where(eq(quotationsTable.id, quotation.id));
    res.json(
      RespondToQuotationResponse.parse({
        id: response.id,
        sellerName: seller.businessName,
        status: response.status,
        totalNgn: response.totalNgn,
        message: response.message,
        createdAt: response.createdAt,
      }),
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
    await db.transaction(async (tx) => {
      await tx
        .update(quotationResponsesTable)
        .set({ status: parsed.data.status, updatedAt: new Date() })
        .where(eq(quotationResponsesTable.id, response.id));
      if (parsed.data.status === "accepted") {
        await tx
          .update(quotationResponsesTable)
          .set({ status: "declined", updatedAt: new Date() })
          .where(
            and(
              eq(quotationResponsesTable.quotationId, quotation.id),
              eq(quotationResponsesTable.status, "quoted"),
            ),
          );
        await tx
          .update(quotationsTable)
          .set({ status: "accepted" })
          .where(eq(quotationsTable.id, quotation.id));
      } else {
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
      }
    });
    const updated = await quotationPayload(quotation.id);
    res.json(UpdateQuotationResponseResponse.parse(updated));
  },
);

export default router;
