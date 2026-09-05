# DIL Computers ERP — Manual Test Plan

50 checks covering every section of the app. Work top to bottom; the later
cases assume the earlier ones passed.

**Before you start**

- Log in as `admin` (default `admin123`) unless a case says otherwise.
- Other accounts: `staff1` / `staff123`, `tech1` / `tech123`.
- Pick one catalogue product to use throughout and note its starting stock
  — several cases check that number moved by exactly the right amount.
- Every rupee figure in the app should read `₹1,23,456.78` (Indian digit
  grouping). In PDFs it reads `Rs. 1,23,456.78`, because the PDF font has
  no ₹ glyph.

---

## Currency (1–4)

| # | Check | Expected |
|---|---|---|
| 1 | Open Overview | Every amount shows `₹`, never `$` |
| 2 | Open Catalogue and read any price | `₹` prefix, Indian grouping (e.g. `₹1,652.58`, not `₹1652.58`) |
| 3 | Download any invoice PDF | Prices read `Rs. …`; no boxes, blanks or mojibake where the symbol goes |
| 4 | Check a large number, e.g. the April revenue tile | Reads `₹15,74,156.50` — lakh grouping, not `₹1,574,156.50` |

## Login & roles (5–10)

| # | Check | Expected |
|---|---|---|
| 5 | Log in with a wrong password | Rejected with an error; no session created |
| 6 | Log in as `admin` | All sections visible, including Users and Customer Insights |
| 7 | Log in as `staff1` | Only the sections staff may use; Users is absent |
| 8 | Log in as `tech1` | Technician view — only tickets assigned to that technician |
| 9 | As `staff1`, request an admin-only URL directly | Server refuses (403), not just a hidden menu item |
| 10 | Log out, then press Back | Returns to login, not a cached dashboard |

## Overview (11–13)

| # | Check | Expected |
|---|---|---|
| 11 | Read "Sales this month" | Matches the Sales Analytics revenue tile for the same month |
| 12 | Read "Outstanding receivables" | Matches the Receivables page total |
| 13 | Read the 5 recent invoices | Newest first, and each opens the right invoice |

## Customers (14–18)

| # | Check | Expected |
|---|---|---|
| 14 | Add a customer with name, phone, GSTIN, 30-day terms | Saved; appears in search immediately |
| 15 | Add a customer with a blank name | Refused with a clear message |
| 16 | Search by partial phone number | Matches, case- and fragment-insensitive |
| 17 | Edit a customer's credit terms to 15 days | Saved; new invoices for them use a 15-day due date |
| 18 | Expand a customer imported from the sales register | Shows their invoice history from April onward |

## Catalogue & stock (19–23)

| # | Check | Expected |
|---|---|---|
| 19 | Search the catalogue for a product name | Matching rows only; paging works |
| 20 | Filter by category | Only that category; 19 categories available |
| 21 | Edit a product's price, HSN and reorder threshold | All three persist after a reload |
| 22 | Set a product's reorder threshold above its stock | It appears in Low Stock |
| 23 | Export the catalogue, change one price, re-import | Only that row changes; row count stays 9,500 |

## Quotations (24–27)

| # | Check | Expected |
|---|---|---|
| 24 | Create a quotation with 2 line items and 18% GST | Subtotal + GST = grand total, to the paisa |
| 25 | Check the product's stock right after | **Unchanged** — quotations never move stock |
| 26 | Open the generated PDF | HSN codes present, `Rs.` amounts, totals match the screen |
| 27 | Search the quotation by its number | Found; expanding shows the same line items |

## Invoices (28–35)

| # | Check | Expected |
|---|---|---|
| 28 | Create an invoice for a saved customer, marked paid | Saved; PDF downloads |
| 29 | Check the product's stock | Dropped by exactly the quantity invoiced |
| 30 | Create an invoice for a walk-in (no saved customer) | Allowed; name and phone captured on the invoice |
| 31 | Try to invoice more units than are in stock | Refused; **stock unchanged** and no partial invoice created |
| 32 | Create an invoice marked unpaid, then record a part payment | Balance due drops by that amount |
| 33 | Try to pay more than the balance due | Refused, naming the amount actually outstanding |
| 34 | Pay the balance in full | Status flips to paid; invoice leaves Receivables |
| 35 | Note an invoice number, then edit the customer's name | Invoice number is unchanged — numbers are permanent |

## Credit notes (36–39)

| # | Check | Expected |
|---|---|---|
| 36 | Raise a credit note for part of an invoice | Accepted; refund total uses the original invoice's price and GST |
| 37 | Check stock | Increased by exactly the quantity returned |
| 38 | Try to return more than remains returnable | Refused |
| 39 | Re-open the original invoice | Untouched — the original stays a true record of what was sold |

## Receivables (40–42)

| # | Check | Expected |
|---|---|---|
| 40 | Open Receivables | Only invoices with a balance; totals match the band figures added up |
| 41 | Click the "1–30 days" band | List filters to that band; "show all" clears it |
| 42 | Check an invoice for a customer with no credit terms | Due date shows "On receipt" |

## GST summary (43–45)

| # | Check | Expected |
|---|---|---|
| 43 | Open GST Summary for April 2026 | Taxable value and tax split by slab; 18% carries the imported register |
| 44 | Raise a credit note, then re-open the summary for that month | Net total drops by the credit note |
| 45 | Download the CSV | Opens in Excel; figures match the screen |

## Sales analytics & monthly data (46–48)

| # | Check | Expected |
|---|---|---|
| 46 | Open Sales Analytics for April 2026 | Revenue `₹15,74,156.50`, 128 invoices |
| 47 | Step through May, June, July, August, September 2026 | Each month has data; the "Last 6 months" chart shows six filled bars, current month highlighted |
| 48 | Hover a daily bar and a top-customer bar | Tooltip shows a readable date (e.g. "26 Apr 2026") and a `₹` amount — no `NaN`, no clipped labels |

## Purchase orders, warranty, re-seed (49–50)

| # | Check | Expected |
|---|---|---|
| 49 | Raise a purchase order for 5 units of a product | Stock rises by 5 and the product's cost price updates |
| 50 | Redeploy (or re-run the seed) | Log says the monthly sales are already imported and skips them; invoice count and revenue are **identical** to before |

---

## Notes

- Cases 29, 31, 37 and 49 are the stock-integrity set — if any of them is
  off by even one unit, stop and investigate before trusting inventory.
- Case 50 is the one that catches a duplicate-import regression. Run it
  after any change to `server/db/seed.js` or to the files in
  `server/data/`.
- April 2026 is real data. May 2026 onward is synthetic — generated by
  `server/data/generate_monthly_sales.py` — so treat its figures as shape,
  not truth.
