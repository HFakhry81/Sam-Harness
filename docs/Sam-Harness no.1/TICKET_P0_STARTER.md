Since you are starting with the first P0, we will focus on **TICKET-BILL-01: Billing Engine**. 

To implement this correctly, we need to move from the abstract "Duration" to a concrete "Invoice." Below is the starter markdown for this specific ticket. You should save this as `TICKET_BILL_01.md` in your tracking folder.

***

# TICKET-BILL-01: Billing Engine Implementation

## 📋 Overview
**Requirement:** Implement the core logic to convert resource usage duration into monetary cost and generate a formal invoice record.
**Status:** 🔴 Not Started
**Priority:** Critical (P0)

## 🎯 Objectives
- [ ] **Rate Registry:** Create a mechanism to define costs per unit of time/resource (e.g., `$50/hr` for `RESOURCE_A`).
- [ ] **Duration Calculator:** Logic to calculate the delta between `start_time` and `end_time` (handling partial hours/minutes).
- [ ] **Cost Engine:** A service that multiplies `Duration` $\times$ `Rate` $\times$ `Quantity`.
- [ ] **Invoice Generator:** Logic to transition a booking from `COMPLETED` $\rightarrow$ `INVOICED` and create an immutable invoice record.

## 🛠 Technical Specification

### 1. Data Model Extensions
We need to ensure the following entities exist or are added:
- `BillingRate`: `{ resourceId: string, ratePerUnit: number, unit: 'HOUR' | 'MINUTE' | 'FLAT' }`
- `Invoice`: `{ invoiceId: string, bookingId: string, totalAmount: number, currency: string, issuedAt: Date, status: 'UNPAID' | 'PAID' }`

### 2. Logic Flow
`Booking (COMPLETED)` $\rightarrow$ `BillingService.calculateCost()` $\rightarrow$ `InvoiceService.createInvoice()` $\rightarrow$ `Booking (INVOICED)`

### 3. Proposed File Structure
- `src/billing/billingEngine.ts`: Core calculation logic.
- `src/billing/rateRegistry.ts`: Management of resource pricing.
- `src/billing/invoiceService.ts`: Persistence and state transition for invoices.

## ⚠️ Constraints & Edge Cases
- **Rounding:** Define if we round up to the nearest 15 minutes or charge exact seconds.
- **Taxes:** Determine if VAT/Tax is a flat percentage or per-resource.
- **Cancellations:** Handle billing for "No-shows" or early terminations.

## ✅ Definition of Done (DoD)
- [ ] Unit tests verify that `1.5 hours` at `$100/hr` equals `$150`.
- [ ] Integration test: A booking status successfully changes to `INVOICED` after the billing engine runs.
- [ ] Invoice record is persisted in the database/state store.
- [ ] Code adheres to `.cursor/rules/workspace-boundary.mdc`.