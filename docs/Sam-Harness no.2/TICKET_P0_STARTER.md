To begin the implementation of the Critical Path, we will start with **P0-BOOK-01**. This is the foundational logic upon which the rest of the booking engine relies.

Below is the starter ticket for the first P0 task.

***

# 🎫 TICKET: P0-BOOK-01
## Appointment Collision Logic

### 📝 Description
Implement the core logic for `BookingType: APPOINTMENT`. The system must ensure that a specific staff member and a specific service cannot be double-booked for the same time slot. This is the primary "collision" prevention layer of the booking engine.

### 🎯 Objectives
- Define the data structures for Appointments.
- Implement a validation engine that checks for temporal overlaps.
- Ensure the logic handles "exclusive" resource locking (Staff + Service).

### 🛠 Technical Requirements
- **Location:** `src/bookings/`
- **Language:** TypeScript
- **Key Components to Implement:**
    - `BookingType` Enum: Include `APPOINTMENT`, `RESOURCE_RENTAL`, `BATCH_SCHEDULE`.
    - `AppointmentBooking` Interface: Define `startTime`, `endTime`, `staffId`, `serviceId`, and `status`.
    - `CollisionDetector` Class/Module: 
        - Method `checkCollision(newBooking: AppointmentBooking, existingBookings: AppointmentBooking[])`: Returns a boolean or a detailed collision report.
        - Logic: `(StartA < EndB) && (EndA > StartB)` for any booking sharing the same `staffId` OR `serviceId`.

### ✅ Acceptance Criteria
- [ ] `BookingType` enum is implemented and exported.
- [ ] `AppointmentBooking` interface is defined with strict typing.
- [ ] `CollisionDetector` correctly identifies overlapping time slots for the same staff member.
- [ ] `CollisionDetector` correctly identifies overlapping time slots for the same service.
- [ ] Unit tests cover:
    - Exact overlap (Same start/end).
    - Partial overlap (Start inside existing booking).
    - Encompassing overlap (New booking wraps around existing booking).
    - Non-overlapping (Adjacent bookings).

### 🔗 Dependencies
- None (This is the base P0).

### 🚩 Next Step
Once merged, this enables **P0-BOOK-02 (Resource Rental)**, which will extend this collision logic to physical assets.