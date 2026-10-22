/**
 * The name a product option is shown under on orders and receipts: the product
 * name, then the option name after an em dash. A product whose only option is
 * unnamed shows just the product name.
 */
export function optionLabel(productName: string, optionName: string): string {
  const option = optionName.trim();
  return option ? `${productName} — ${option}` : productName;
}
