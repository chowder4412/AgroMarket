export interface QuotationLineQuantity {
  quotationItemId: number;
  quantity: number;
}

export interface QuotationLinePrice {
  quotationItemId: number;
  unitPriceNgn: number;
}

export interface PricedQuotationLine extends QuotationLinePrice {
  quantity: number;
}

export function calculateQuotationPrice(
  requestedItems: QuotationLineQuantity[],
  proposedPrices: QuotationLinePrice[],
): { items: PricedQuotationLine[]; totalNgn: number } {
  if (!requestedItems.length || proposedPrices.length !== requestedItems.length) {
    throw new Error("A price is required for every requested item.");
  }

  const prices = new Map<number, number>();
  for (const proposed of proposedPrices) {
    if (
      prices.has(proposed.quotationItemId) ||
      !Number.isSafeInteger(proposed.unitPriceNgn) ||
      proposed.unitPriceNgn <= 0
    ) {
      throw new Error("Quote line prices must be unique positive whole naira amounts.");
    }
    prices.set(proposed.quotationItemId, proposed.unitPriceNgn);
  }

  const items = requestedItems.map((item) => {
    const unitPriceNgn = prices.get(item.quotationItemId);
    if (unitPriceNgn === undefined || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Quote line items do not match the request.");
    }
    return { quotationItemId: item.quotationItemId, quantity: item.quantity, unitPriceNgn };
  });
  if (prices.size !== items.length) {
    throw new Error("Quote line items do not match the request.");
  }

  const totalNgn = items.reduce((total, item) => total + item.quantity * item.unitPriceNgn, 0);
  if (!Number.isSafeInteger(totalNgn) || totalNgn <= 0) {
    throw new Error("The quote total is outside the supported range.");
  }
  return { items, totalNgn };
}