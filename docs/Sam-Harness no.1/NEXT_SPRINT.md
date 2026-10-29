# NEXT_SPRINT.md

## 🎯 Primary Objective
Close the critical gap between the Project Specification and the current codebase, focusing on the **Booking Lifecycle** and **Billing Engine**.

## 🚨 Critical Path (High Priority)
| Ticket | Feature | Focus | Severity |
| :--- | :--- | :--- | :--- |
| **TICKET-BILL-01** | **Billing Engine** | Implement Duration $\rightarrow$ Cost $\rightarrow$ Invoice logic | 🔴 Critical |
| **TICKET-QR-01** | **QR Generation** | Implement time-bound token generation for `CONFIRMED` status | 🔴 Critical |
| **TICKET-BOOK-01** | **Booking Primitives** | Implement `APPOINTMENT`, `RESOURCE_RENTAL`, `BATCH_SCHEDULE` | 🟠 High |
| **TICKET-STATE-01** | **State Machine** | Implement transitions: `PENDING` $\rightarrow$ `INVOICED` | 🟠 High |
| **TICKET-OCC-01** | **Occupancy** | Implement Capacity and Collision validation logic | 🟠 High |

## 🛠️ Secondary Path (Medium Priority)
| Ticket | Feature | Focus | Severity |
| :--- | :--- | :--- | :--- |
| **TICKET-QR-02** | **QR Validation** | Map QR scan signals to `CHECKED_IN` status update | 🟡 Medium |

## ✅ Verified / Stable (Maintenance Only)
- Workspace Isolation
- RBAC / Role Definitions
- Task Lifecycle Management
- Evidence/Audit Trail
- Agent Memory/Context