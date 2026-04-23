# Pipeline Reference

## Status flow

```
new ──► processing ──► parsed ──► ready ──► distributed ──► awaiting ──► completed
 ◄──────────────────────────────────────────────────────────────────────────────
                    (any step-back requires a written comment)
```

### Status descriptions

| Status | Color | Meaning |
|---|---|---|
| `new` | Blue | Email received from inbox, not yet processed |
| `processing` | Amber | LLM call in progress |
| `parsed` | Purple | Data extracted, awaiting review |
| `ready` | Green | Reviewed, cleared for supplier outreach |
| `distributed` | Pink | RFQ emails sent to all suppliers |
| `awaiting` | Orange | Waiting for supplier responses |
| `completed` | Bright green | Order placed or case closed |
| `error` | Red | Processing failed |

---

## Advancing a step

**From the table row**: click **▸** on the right side of any row.

**From the detail panel**: click **קדם שלב ▸** button.

Each click moves the RFQ forward by exactly one step.

---

## Going back a step (step-back)

**From the table row**: click **◂** (only visible when status is not `new`).

**From the detail panel**: click **◂ חזרה** button.

A modal will appear requiring a **mandatory comment** explaining why the step is being reversed. The comment is stored in the **status history audit trail** and cannot be skipped.

### Step-back modal

- Type your reason in the text area (minimum 1 character)
- Press **Ctrl+Enter** or click **◂ חזרה** to confirm
- Click outside the modal or press **Escape** to cancel without making any change

---

## Status history (audit trail)

Every step-back is recorded in `statusHistory[]` on the RFQ object:

```json
{
  "from": "distributed",
  "to": "ready",
  "comment": "Supplier list was incomplete, need to add two more contacts",
  "ts": "14:32:07"
}
```

View the full history in the **detail panel** → scroll down to **היסטוריית שלבים**.

---

## Human-in-Loop flag

Any RFQ can be flagged for manual review before supplier emails are sent:

- **Set**: click 🔍 in the row, detail panel, or Test tab Section B
- **Effect**: the "Send to Suppliers" button is disabled while the flag is active
- **Visual**: amber 🔍 indicator on the row, **HUMAN REVIEW** badge in the detail panel
- **Clear**: click 🔍 again to remove the flag

This is useful when:
- The AI extraction looks uncertain
- The part is obsolete and needs manual verification
- The customer is sensitive (military, defense)

---

## Priority levels

| Priority | Indicator | Auto-assigned when |
|---|---|---|
| `high` | Red left border | Obsolete part, urgent delivery, qty > 5000, military/defense customer |
| `medium` | — | Standard request |
| `low` | — | Small quantity, flexible timeline |

Priority is set by the AI during parsing and can be overridden in future versions.

---

## Obsolete (OBS) detection

The AI and the dashboard detect obsolete parts from the following indicators:

**Hebrew**: אובסולייט, אובסולייטית, אובסולט, אובסלט  
**English**: obs, obsolete, obsolte, obslete, absolete, EOL, NRND, PDN, discontinued, last time buy, LTB, NLM

When detected:
- **OBS badge** appears on the table row (orange)
- **Row background** has orange tint
- **OBSOLETE badge** appears in the detail panel header
- **Row priority** is automatically set to `high`
- **Supplier email** includes a red warning row: "OBSOLETE PART — please confirm date code and country of origin"
- **OBS ONLY** filter chip in the toolbar highlights/filters to show only these rows

---

## Filters and search

| Filter | Location | Function |
|---|---|---|
| Text search | Toolbar right | Filters by part number, customer name, or special requirements |
| Status dropdown | Toolbar right | Filter to a single status |
| OBS ONLY chip | Toolbar left | Show only obsolete parts |
| ✕ clear button | Toolbar right | Clears all active filters at once |

The row count shows `filtered/total` when any filter is active (e.g. `PROCESSED RFQs (3/12)`).

---

## Deleting RFQs

**Single row**: hover over a row → click the **×** button that appears on the right (turns red on hover). No confirmation required.

**All rows**: click **🗑 נקה הכל** in the toolbar → confirm the browser dialog. This wipes the entire list and clears localStorage.
