import { Router, type IRouter } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
} from "drizzle-orm";
import {
  db,
  farmsTable,
  inventoryTable,
  productsTable,
  productWholesaleTiersTable,
  sellerProfilesTable,
} from "@workspace/db";
import {
  CreateProductBody,
  CreateProductResponse,
  GetProductParams,
  GetProductResponse,
  ListFeaturedFarmsResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

async function findProduct(id: number) {
  const [row] = await db
    .select({
      id: productsTable.id,
      name: productsTable.name,
      description: productsTable.description,
      category: productsTable.category,
      unit: productsTable.unit,
      priceNgn: productsTable.priceNgn,
      minOrder: productsTable.minOrder,
      imageUrl: productsTable.imageUrl,
      location: productsTable.location,
      sellerId: sellerProfilesTable.userId,
      sellerName: sellerProfilesTable.businessName,
      farmName: farmsTable.name,
      verified: sellerProfilesTable.verified,
      rating: farmsTable.rating,
      quantity: inventoryTable.quantity,
      reserved: inventoryTable.reserved,
    })
    .from(productsTable)
    .innerJoin(
      sellerProfilesTable,
      eq(productsTable.sellerId, sellerProfilesTable.id),
    )
    .leftJoin(farmsTable, eq(productsTable.farmId, farmsTable.id))
    .leftJoin(inventoryTable, eq(productsTable.id, inventoryTable.productId))
    .where(and(eq(productsTable.id, id), eq(productsTable.status, "active")))
    .limit(1);

  if (!row) return null;
  const tiers = await db
    .select({
      minQuantity: productWholesaleTiersTable.minQuantity,
      unitPrice: productWholesaleTiersTable.unitPriceNgn,
    })
    .from(productWholesaleTiersTable)
    .where(eq(productWholesaleTiersTable.productId, id))
    .orderBy(asc(productWholesaleTiersTable.minQuantity));

  return GetProductResponse.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    unit: row.unit,
    price: row.priceNgn,
    minOrder: row.minOrder,
    stock: Math.max(0, (row.quantity ?? 0) - (row.reserved ?? 0)),
    imageUrl: row.imageUrl,
    location: row.location,
    sellerId: String(row.sellerId),
    sellerName: row.sellerName,
    farmName: row.farmName ?? row.sellerName,
    verified: row.verified,
    rating: row.rating ?? 4.8,
    wholesaleTiers: tiers,
  });
}

router.get("/products", async (req, res): Promise<void> => {
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { search, category, location, sort } = parsed.data;
  const filters = [eq(productsTable.status, "active")];
  if (category) filters.push(eq(productsTable.category, category));
  if (location) filters.push(ilike(productsTable.location, `%${location}%`));
  if (search) {
    filters.push(
      or(
        ilike(productsTable.name, `%${search}%`),
        ilike(productsTable.description, `%${search}%`),
        ilike(productsTable.location, `%${search}%`),
        ilike(sellerProfilesTable.businessName, `%${search}%`),
      )!,
    );
  }

  const query = db
    .select({
      id: productsTable.id,
      name: productsTable.name,
      description: productsTable.description,
      category: productsTable.category,
      unit: productsTable.unit,
      priceNgn: productsTable.priceNgn,
      minOrder: productsTable.minOrder,
      imageUrl: productsTable.imageUrl,
      location: productsTable.location,
      sellerId: sellerProfilesTable.userId,
      sellerName: sellerProfilesTable.businessName,
      farmName: farmsTable.name,
      verified: sellerProfilesTable.verified,
      rating: farmsTable.rating,
      quantity: inventoryTable.quantity,
      reserved: inventoryTable.reserved,
    })
    .from(productsTable)
    .innerJoin(
      sellerProfilesTable,
      eq(productsTable.sellerId, sellerProfilesTable.id),
    )
    .leftJoin(farmsTable, eq(productsTable.farmId, farmsTable.id))
    .leftJoin(inventoryTable, eq(productsTable.id, inventoryTable.productId))
    .where(and(...filters));

  const rows =
    sort === "price_asc"
      ? await query.orderBy(asc(productsTable.priceNgn))
      : sort === "price_desc"
        ? await query.orderBy(desc(productsTable.priceNgn))
        : await query.orderBy(
            desc(sellerProfilesTable.verified),
            desc(productsTable.createdAt),
          );
  const ids = rows.map((row) => row.id);
  const tiers = ids.length
    ? await db
        .select({
          productId: productWholesaleTiersTable.productId,
          minQuantity: productWholesaleTiersTable.minQuantity,
          unitPrice: productWholesaleTiersTable.unitPriceNgn,
        })
        .from(productWholesaleTiersTable)
        .where(inArray(productWholesaleTiersTable.productId, ids))
        .orderBy(asc(productWholesaleTiersTable.minQuantity))
    : [];
  const tiersByProduct = new Map<number, typeof tiers>();
  for (const tier of tiers) {
    const list = tiersByProduct.get(tier.productId) ?? [];
    list.push(tier);
    tiersByProduct.set(tier.productId, list);
  }
  const output = rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    unit: row.unit,
    price: row.priceNgn,
    minOrder: row.minOrder,
    stock: Math.max(0, (row.quantity ?? 0) - (row.reserved ?? 0)),
    imageUrl: row.imageUrl,
    location: row.location,
    sellerId: String(row.sellerId),
    sellerName: row.sellerName,
    farmName: row.farmName ?? row.sellerName,
    verified: row.verified,
    rating: row.rating ?? 4.8,
    wholesaleTiers: (tiersByProduct.get(row.id) ?? []).map((tier) => ({
      minQuantity: tier.minQuantity,
      unitPrice: tier.unitPrice,
    })),
  }));
  res.json(ListProductsResponse.parse(output));
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const product = await findProduct(params.data.id);
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  res.json(product);
});

router.post(
  "/products",
  requireAuth,
  requireRole("farmer", "supplier"),
  async (req, res): Promise<void> => {
    const parsed = CreateProductBody.safeParse(req.body);
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

    let [farm] = await db
      .select()
      .from(farmsTable)
      .where(
        and(
          eq(farmsTable.sellerId, seller.id),
          eq(farmsTable.name, parsed.data.farmName),
        ),
      )
      .limit(1);
    if (!farm) {
      [farm] = await db
        .insert(farmsTable)
        .values({
          sellerId: seller.id,
          name: parsed.data.farmName,
          location: parsed.data.location,
          description: "",
          imageUrl: parsed.data.imageUrl,
          verified: seller.verified,
        })
        .returning();
    }

    const [created] = await db
      .insert(productsTable)
      .values({
        sellerId: seller.id,
        farmId: farm?.id,
        name: parsed.data.name,
        description: parsed.data.description,
        category: parsed.data.category,
        unit: parsed.data.unit,
        priceNgn: Math.round(parsed.data.price),
        minOrder: parsed.data.minOrder,
        imageUrl: parsed.data.imageUrl,
        location: parsed.data.location,
        status: seller.verified ? "active" : "pending",
      })
      .returning();
    await db.insert(inventoryTable).values({
      productId: created.id,
      quantity: parsed.data.stock,
      reserved: 0,
    });
    const tiers = parsed.data.wholesaleTiers ?? [];
    if (tiers.length) {
      await db.insert(productWholesaleTiersTable).values(
        tiers.map((tier) => ({
          productId: created.id,
          minQuantity: tier.minQuantity,
          unitPriceNgn: Math.round(tier.unitPrice),
        })),
      );
    }
    const product = await findProduct(created.id);
    if (!product) {
      res.status(201).json(
        CreateProductResponse.parse({
          id: created.id,
          name: created.name,
          description: created.description,
          category: created.category,
          unit: created.unit,
          price: created.priceNgn,
          minOrder: created.minOrder,
          stock: parsed.data.stock,
          imageUrl: created.imageUrl,
          location: created.location,
          sellerId: String(seller.userId),
          sellerName: seller.businessName,
          farmName: parsed.data.farmName,
          verified: seller.verified,
          rating: 4.8,
          wholesaleTiers: tiers,
        }),
      );
      return;
    }
    res.status(201).json(product);
  },
);

router.patch(
  "/products/:id",
  requireAuth,
  requireRole("farmer", "supplier"),
  async (req, res): Promise<void> => {
    const params = UpdateProductParams.safeParse(req.params);
    const parsed = UpdateProductBody.safeParse(req.body);
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
    const [owned] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.id, params.data.id),
          eq(productsTable.sellerId, seller?.id ?? -1),
        ),
      )
      .limit(1);
    if (!owned) {
      res.status(404).json({ error: "Product not found for this seller." });
      return;
    }

    const { wholesaleTiers, stock, price, ...fields } = parsed.data;
    await db
      .update(productsTable)
      .set({
        ...fields,
        priceNgn: price === undefined ? undefined : Math.round(price),
      })
      .where(eq(productsTable.id, params.data.id));
    if (stock !== undefined) {
      const [inventory] = await db
        .select()
        .from(inventoryTable)
        .where(eq(inventoryTable.productId, params.data.id))
        .limit(1);
      if (inventory && stock < inventory.reserved) {
        res.status(409).json({ error: "Stock cannot be lower than reserved units." });
        return;
      }
      await db
        .insert(inventoryTable)
        .values({ productId: params.data.id, quantity: stock, reserved: 0 })
        .onConflictDoUpdate({
          target: inventoryTable.productId,
          set: { quantity: stock },
        });
    }
    if (wholesaleTiers !== undefined) {
      await db
        .delete(productWholesaleTiersTable)
        .where(eq(productWholesaleTiersTable.productId, params.data.id));
      if (wholesaleTiers.length) {
        await db.insert(productWholesaleTiersTable).values(
          wholesaleTiers.map((tier) => ({
            productId: params.data.id,
            minQuantity: tier.minQuantity,
            unitPriceNgn: Math.round(tier.unitPrice),
          })),
        );
      }
    }
    const product = await findProduct(params.data.id);
    if (!product) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    res.json(UpdateProductResponse.parse(product));
  },
);

router.get("/farms/featured", async (_req, res): Promise<void> => {
  const farms = await db
    .select({
      id: farmsTable.id,
      name: farmsTable.name,
      location: farmsTable.location,
      description: farmsTable.description,
      imageUrl: farmsTable.imageUrl,
      sellerName: sellerProfilesTable.businessName,
      verified: farmsTable.verified,
    })
    .from(farmsTable)
    .innerJoin(
      sellerProfilesTable,
      eq(farmsTable.sellerId, sellerProfilesTable.id),
    )
    .where(eq(farmsTable.verified, true))
    .limit(8);
  const output = await Promise.all(
    farms.map(async (farm) => {
      const [{ count: productCount }] = await db
        .select({ count: count(productsTable.id) })
        .from(productsTable)
        .where(
          and(
            eq(productsTable.farmId, farm.id),
            eq(productsTable.status, "active"),
          ),
        );
      return { ...farm, productCount: productCount ?? 0 };
    }),
  );
  res.json(ListFeaturedFarmsResponse.parse(output));
});

export default router;
