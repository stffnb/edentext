import { t } from '../i18n/i18n.svelte';
import type { TemplateData, TemplateEntry } from './types';
import { BOLD, LINE_PT, MM_TO_PT, P, PLH, RETURN_SPACE_AFTER_PT, ROW, SMALL, T, TBL, TC, THC, dateField, type N } from './builders';

// Invoice on the Form B letterhead geometry: 45mm address field, invoice numbers in
// the 125mm info column, then an item table with totals and the payment terms.

// 45mm target − 20mm margin − one letterhead line.
const RETURN_SPACE_BEFORE_PT = Math.round((45 - 20) * MM_TO_PT - LINE_PT);
const INFO_TAB = '10l';
// Proportional column weights: item no., description, quantity, unit price, amount.
const COLS = [900, 4500, 1000, 1800, 1800];
const RIGHT = { textAlign: 'right' };

function buildInvoice(): TemplateData {
  const L = t().templates.letter;
  const I = t().templates.invoice;
  const itemRow = (no: string, filled: boolean): N =>
    ROW(
      TC({ colwidth: [COLS[0]] }, P(null, T(no))),
      TC({ colwidth: [COLS[1]] }, filled ? P(null, PLH(I.itemDesc)) : P(null)),
      TC({ colwidth: [COLS[2]] }, filled ? P(RIGHT, PLH(I.qty)) : P(RIGHT)),
      TC({ colwidth: [COLS[3]] }, filled ? P(RIGHT, PLH(I.amount)) : P(RIGHT)),
      TC({ colwidth: [COLS[4]] }, filled ? P(RIGHT, PLH(I.amount)) : P(RIGHT)),
    );
  const sumRow = (label: string, bold: boolean): N =>
    ROW(
      TC({ colspan: 4, colwidth: COLS.slice(0, 4) }, P(RIGHT, T(label, ...(bold ? [BOLD] : [])))),
      TC({ colwidth: [COLS[4]] }, P(RIGHT, PLH(I.amount, ...(bold ? [BOLD] : [])))),
    );
  return {
    margins: { top: 2, bottom: 2, left: 2.5, right: 2 },
    foldMarks: true,
    content: {
      type: 'doc',
      content: [
        P(null, PLH(L.companyName, BOLD)),
        // The one-line return address opens the address field at 45mm from the top.
        // fontSize also shrinks the paragraph mark, so the line box is 8pt tall.
        P({ spaceBefore: RETURN_SPACE_BEFORE_PT, spaceAfter: RETURN_SPACE_AFTER_PT, fontSize: '8pt' }, PLH(L.returnAddress, SMALL)),
        P({ tabStops: INFO_TAB }, PLH(L.recipientCompany), T('\t'), T(I.invoiceNo), PLH(I.number)),
        P({ tabStops: INFO_TAB }, PLH(L.recipientName), T('\t'), T(I.customerNo), PLH(I.number)),
        P({ tabStops: INFO_TAB }, PLH(L.recipientStreet), T('\t'), T(L.dateLabel), dateField()),
        P(null, PLH(L.recipientCity)),
        P(null),
        P(null),
        P(null, T(I.subject, BOLD), PLH(I.number, BOLD)),
        P(null),
        P(null, PLH(L.salutation)),
        P(null),
        P(null, T(I.intro)),
        P(null),
        TBL({ tableStyle: 'Simple Grid' },
          ROW(
            THC({ colwidth: [COLS[0]] }, P(null, T(I.colPos))),
            THC({ colwidth: [COLS[1]] }, P(null, T(I.colDescription))),
            THC({ colwidth: [COLS[2]] }, P(RIGHT, T(I.colQty))),
            THC({ colwidth: [COLS[3]] }, P(RIGHT, T(I.colUnitPrice))),
            THC({ colwidth: [COLS[4]] }, P(RIGHT, T(I.colAmount))),
          ),
          itemRow('1', true),
          itemRow('2', false),
          itemRow('3', false),
          sumRow(I.subtotal, false),
          sumRow(I.vat, false),
          sumRow(I.total, true),
        ),
        P(null),
        P(null, T(I.paymentBefore), PLH(L.date), T(I.paymentAfter)),
        P(null),
        P(null, T(L.closing)),
        P(null),
        P(null),
        P(null),
        P(null, PLH(L.signature)),
        P(null),
        P(null, T(I.bankLabel), PLH(I.bank), T(' · '), T(I.ibanLabel), PLH(I.iban), T(' · '), T(I.bicLabel), PLH(I.bic)),
        P(null, T(I.vatIdLabel), PLH(I.number)),
      ],
    },
  };
}

export const invoice: TemplateEntry = {
  id: 'invoice',
  name: () => t().templates.invoice.name,
  description: () => t().templates.invoice.description,
  build: buildInvoice,
};
