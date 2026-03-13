function roundMoneySql(expression) {
  return `ROUND((${expression}) * 100) / 100`;
}

module.exports = {
  name: '005_backfill_quote_tax_amounts',
  async up(tx) {
    const quoteTaxExpr = roundMoneySql('COALESCE(q.subtotal_untaxed, 0) * 0.05');
    const quoteTotalExpr = roundMoneySql(`COALESCE(q.subtotal_untaxed, 0) + ${quoteTaxExpr}`);

    await tx.query(`
      UPDATE quotes q
      SET q.tax_amount = ${quoteTaxExpr},
          q.total_amount = ${quoteTotalExpr}
      WHERE COALESCE(q.subtotal_untaxed, 0) > 0
        AND (
          q.tax_amount IS NULL
          OR q.tax_amount = 0
          OR q.total_amount IS NULL
          OR q.total_amount = 0
          OR q.total_amount = q.subtotal_untaxed
        )
    `);

    const itemTaxExpr = roundMoneySql('COALESCE(qi.line_total_untaxed, 0) * 0.05');
    const itemTotalExpr = roundMoneySql(`COALESCE(qi.line_total_untaxed, 0) + ${itemTaxExpr}`);

    await tx.query(`
      UPDATE quote_items qi
      SET qi.tax_amount = ${itemTaxExpr},
          qi.line_total_amount = ${itemTotalExpr},
          qi.pricing_breakdown_json =
            CASE
              WHEN qi.pricing_breakdown_json IS NULL OR qi.pricing_breakdown_json = '' THEN qi.pricing_breakdown_json
              ELSE JSON_SET(
                qi.pricing_breakdown_json,
                '$.taxAmount', ${itemTaxExpr},
                '$.totalAmount', ${itemTotalExpr}
              )
            END
      WHERE COALESCE(qi.line_total_untaxed, 0) > 0
        AND (
          qi.tax_amount IS NULL
          OR qi.tax_amount = 0
          OR qi.line_total_amount IS NULL
          OR qi.line_total_amount = 0
          OR qi.line_total_amount = qi.line_total_untaxed
        )
    `);

    const billingTaxExpr = roundMoneySql('COALESCE(br.amount_untaxed, 0) * 0.05');
    const billingTotalExpr = roundMoneySql(`COALESCE(br.amount_untaxed, 0) + ${billingTaxExpr}`);

    await tx.query(`
      UPDATE billing_records br
      SET br.tax_amount = ${billingTaxExpr},
          br.amount_total = ${billingTotalExpr}
      WHERE COALESCE(br.amount_untaxed, 0) > 0
        AND (
          br.tax_amount IS NULL
          OR br.tax_amount = 0
          OR br.amount_total IS NULL
          OR br.amount_total = 0
          OR br.amount_total = br.amount_untaxed
        )
    `);
  },
};
