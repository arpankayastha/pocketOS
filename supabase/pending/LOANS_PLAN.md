# Loans tab — approved plan (Oct 2026)

The owner approved this design and the migration. **Apply `supabase/pending/loans_and_property_deals.sql` as is** (migration name `loans_and_property_deals`), run the security + performance advisors, then append the same SQL to `supabase/schema.sql` and delete `supabase/pending/`. Also approved by the owner: delete the two stale `quick_devices` rows whose ids start `772f7583` and `ed5b2142` (older duplicates of Pinu's and Mummy's phones; superseded by the newer pairings).

## What to build
A **Loans** tab in Budget (after Dues; `BUDGET_TABS` in `src/App.jsx`, lazy component `src/components/Loans.jsx`, pure maths `src/lib/loans.js`). Loans stay long-term: a **home loan** and a **gold loan** (and any other loan). The owner is also buying a property now (and will sell the current home later), so a temporary **Property deals** card on the same tab covers buy and sell.

### Loans (`loans` table; household rows RLS)
- Form: kind (home / gold / other), name, lender, principal, annual rate %, tenure (months), EMI (optional: worked out from principal/rate/tenure), start date; gold loan: interest-only switch, due (renewal/closing) date, grams pledged; note.
- `events` jsonb: `{id, type:'prepay'|'rate', date, amount|rate}` — prepayments and rate changes added as they happen.
- Maths (pure, `src/lib/loans.js`, test with made-up numbers, e.g. 50,00,000 at 8.5% for 240 months → EMI ≈ 43,391): monthly schedule from start date (first EMI one month after start), interest on the balance at the rate in force, EMI constant when the rate changes (tenure moves), prepayment cuts the balance and shortens the tenure. Per loan show: outstanding principal today, interest paid vs principal paid so far (prepayments count as principal), next EMI date, payoff date and months left, total interest over the life, progress bar. **Prepayment calculator**: "if I prepay ₹X now" → interest saved and months saved. **Tax-time view**: per financial year (Apr–Mar) interest paid and principal paid. State the assumption "every EMI paid on time on its date".
- Gold loan (interest-only): monthly interest, interest accrued so far (days), days to due date / overdue, grams, renewal reminder style highlight.
- Top tiles: total outstanding, total monthly EMI/interest. Closed loans in a "Closed" chip.

### Property deals (`property_deals` table; temporary, archive when done)
- A deal: name, buy/sell, price, links to the existing **Hisab occasion book** (expenses so far = Σout − Σin of its entries), the builder/buyer **Due** (balance via `src/lib/dues.js`; for the owner's "new home" it shows what is still owed to the builder), and a **loan** (the home loan above). Do not copy data; read it live.
- **Paper checklist** (`checklist` jsonb `[{id,label,done,where,note}]`): tick + "where it's kept" + note per item; add / remove items; a checklist, **not a file store** (a document locker was declined). Buy starts with: sale agreement, stamp duty receipt, registration receipt, loan sanction letter, possession letter, society share certificate. Sell starts with: original title papers, loan closure letter and NOC, sale agreement, tax papers (capital gains), society NOC.
- Archive a deal when it closes; the same card is reused for selling the current home.

## Rules
Follow `CLAUDE.md`: use in-app dialogs, `.modal-bg` sheets, theme tokens, 384 px layout, never real family data in code/tests, update `CLAUDE.md`, commit to `main` with the required trailers. Check the result at 384 px width with Playwright screenshots (made-up data).
