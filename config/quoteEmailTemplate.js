const { getBrandingConfig } = require('./branding');

function compactLines(lines = []) {
  return lines.filter((line, index, arr) => !(line === '' && arr[index - 1] === ''));
}

function getQuoteEmailTemplateConfig() {
  const branding = getBrandingConfig();
  return {
    introLine: '附件為本次遊戲檢測報價單，請您查收。如需調整平台內容、補充資料或重新排程，歡迎直接回信與我們聯繫。',
    labels: {
      quotationNo: '報價單編號',
      gameTitle: '遊戲名稱',
      quoteDate: '報價日期',
    },
    notesTitle: '備註說明：',
    noteLines: [...(branding.platformNotes || [])],
    validityLine: `報價有效期限：本報價單自報價日起 ${branding.quoteValidityDays} 天內有效，逾期需重新確認報價條件。`,
    closing: 'Best Regards,',
    companyNameZh: branding.companyNameZh,
  };
}

function buildQuoteEmailLines(context = {}) {
  const template = getQuoteEmailTemplateConfig();
  const greetingName = context.customerContactName || context.customerName || '您好';
  const signatureLines = compactLines([
    template.closing,
    '',
    context.salesContactName || '',
    context.salesContactPhone || '',
    context.salesContactEmail || '',
    template.companyNameZh,
  ]);

  return compactLines([
    `${greetingName} 你好：`,
    template.introLine,
    '',
    `${template.labels.quotationNo}：${context.quotationNo || '?'}`,
    '',
    `${template.labels.gameTitle}：${context.gameTitle || '?'}`,
    '',
    `${template.labels.quoteDate}：${context.quoteDate || '?'}`,
    '',
    template.notesTitle,
    ...template.noteLines,
    template.validityLine,
    '',
    ...signatureLines,
  ]);
}

module.exports = {
  getQuoteEmailTemplateConfig,
  buildQuoteEmailLines,
};
