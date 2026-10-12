// Review statuses shared by the design site's landing and the Vehicles pages (R126). A status lives in data
// (poc/design.json for entries, <id>/review.json for vehicles), never in hand-edited HTML.
export const STATUS = {
  'awaiting-review': 'Awaiting review',
  accepted: 'Accepted',
  'changes-asked': 'Changes asked',
  'no-review-data': 'No review data',
};
export const chip = (status) => `<span class="chip ${status}">${STATUS[status] ?? status}</span>`;
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
