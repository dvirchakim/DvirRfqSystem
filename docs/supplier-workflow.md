# Supplier Workflow

End-to-end guide for managing suppliers, sending RFQs, and processing their responses.

---

## 1. Add suppliers to the list

Go to **Config tab → רשימת ספקים (Supplier List)**:

1. Enter the supplier's **name** (e.g. `Arrow Electronics`)
2. Enter their **email** (e.g. `rfq@arrow.com`)
3. Press **Enter** or click **+ הוסף**
4. Repeat for each supplier

The list is saved to `localStorage` automatically and persists across sessions.

> **Tip**: You can add as many suppliers as you like. Every outbound RFQ email is sent to all of them simultaneously.

---

## 2. Send an RFQ to suppliers

### From the Dashboard tab

1. Find the RFQ row with status `ready` (green badge)
2. Click the row to open the **detail panel** on the right
3. Click **📤 שלח לספקים** — the email is sent to all suppliers in your list
4. The status advances automatically to `distributed`

### From the Test tab (Section B — preview first)

1. Go to **Test → Section B**
2. Select the RFQ from the dropdown
3. Preview the exact HTML email that will be sent
4. Optionally toggle the **Human Loop** flag (see below)
5. Click **📤 שלח** when satisfied

---

## 3. The supplier email format

The outbound email is in English (for international suppliers) and includes:

| Field | Source |
|---|---|
| Part Number | Parsed from the original RFQ email |
| Quantity | Parsed from the original RFQ email |
| End Customer | Parsed (company name) |
| Required Delivery | Parsed delivery date, or "ASAP — please advise lead time" if missing |
| Target Price | Parsed target price, or "Open — please quote best price" if not set |
| Accepts Alternatives | כן / לא / לא צוין |
| Special Requirements | Any notes from the original RFQ |
| Obsolete note | Red row added if the part is flagged as OBS |

---

## 4. Human-in-Loop flag

Before sending, you can mark an RFQ for **manual review**:

- Click 🔍 in the dashboard row **or** the detail panel **or** Test tab Section B
- While flagged, the **Send to Suppliers** button is disabled
- The row shows an amber 🔍 indicator
- Remove the flag to unblock sending

Use this for RFQs where you want to double-check the AI extraction before committing to supplier outreach.

---

## 5. Automatic follow-up emails

When the system processes a **real inbox email** (Gmail or Outlook poll — not a manual Test tab paste) and the extracted RFQ has **no delivery date**, it automatically sends a follow-up to the original sender asking for the required delivery date, listing the affected part numbers and customer names.

This only fires when:
- A real mailbox is connected (Gmail or Outlook)
- The email came from the live inbox (not pasted manually)
- At least one extracted part has no delivery date
- The sender email was extractable from the email headers

---

## 6. Process a supplier response

When a supplier replies to your outreach:

### Using the Test tab (Section C)

1. Go to **Test → Section C**
2. Load a `.eml` file from the dropdown **or** paste the reply email text directly
3. Select the **linked RFQ** from the dropdown (to calculate score relative to target price/quantity)
4. Click **📊 עבד תגובה**
5. The AI extracts: supplier name, part number, unit price, lead time, available qty, MOQ, in-stock status, notes
6. A **score 0–100** is calculated:
   - 💰 Price savings vs. target price: up to 40 pts
   - ⏱ Lead time: up to 40 pts (in-stock = 40, ≤7d = 35, ≤21d = 28, etc.)
   - 📦 Available quantity vs. RFQ quantity: up to 20 pts
7. The response is attached to the linked RFQ
8. If the RFQ status is `distributed`, it advances to `awaiting`

### Viewing all responses for an RFQ

Click any RFQ row → detail panel → **📊 תגובות ספקים** section shows a comparison table with all supplier quotes, color-coded scores, and the best offer highlighted with ★.

---

## 7. Status flow reference

```
new → processing → parsed → ready → distributed → awaiting → completed
```

- **new**: email received from inbox, queued for processing
- **processing**: LLM call in progress
- **parsed**: data extracted, ready for review
- **ready**: reviewed and approved for supplier outreach
- **distributed**: RFQ sent to all suppliers
- **awaiting**: waiting for supplier responses
- **completed**: order placed / closed

Use **▸** to advance one step, **◂** to go back one step (a comment is required for every step-back — stored in the audit trail).
