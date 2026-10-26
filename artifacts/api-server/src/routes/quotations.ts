import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  productsTable,
  quotationItemsTable,
  quotationsTable,
  sellerProfilesTable,
} from "@workspace/db";
import {
  CreateQuotationBody,
  CreateQuotationResponse,
  ListQuotationsResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

async function quotationPayload(id: number) {
  const [quotation] = await db
    .select()
    .from(quotationsTable)
    .where(eq(quotationsTable.id, id))
    .limit(1);
  if (!quotation) return null;
  const items = await db
    .select({
      productId: productsTable.id,
      name: productsTable.name,
      unit: productsTable.unit,
      unitPrice: productsTable.priceNgn,
      quantity: quotationItemsTable.quantity,
      sellerName: sellerProfilesTable.businessName,
    })
    .from(quotationItemsTable)
    .innerJoin(productsTable, eq(quotationItemsTable.productId, productsTable.id))
    .innerJoin(
      sellerProfilesTable,
      eq(productsTable.sellerId, sellerProfilesTable.id),
    )
    .where(eq(quotationItemsTable.quotationId, id));
  return {
    id: quotation.id,
    businessName: quotation.businessName,
    status: quotation.status,
    notes: quotation.notes,
    createdAt: quotation.createdAt,
    items,
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

export default router;
