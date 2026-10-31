# Pending Task (not executed yet)

## Prompt
حلل الكود في المسار E:\UpNexa.com\spendy

## Ready
true

## Clarifications
- none

---

# Sam-Harness Task

## Route
architecture

## Title
حلل الكود في المسار E:\UpNexa.com\spendy

## Goal
حلل الكود في المسار E:\UpNexa.com\spendy

## Task Spec
- id: `----e-upnexa-com-spendy-mvw8tkd6`
- intent: analyze
- confidence: 0.60
- risk: `low`

## Target
- targetRepo: `/workspace`
- packDir: `/workspace/docs`

## Hard boundary
- READ for evidence; WRITE pack under `Sam-Harness no.X` only unless GO.
- On [REJECTED]: أسباب الرفض + درجة الخطورة + طريقة الحل.
- Forbidden: client_code_edit_without_go

## Mission
1. Intake / Evidence
2. Strategist ↔ Auditor (≤5)
3. Architect / Help / Marketer after APPROVED
4. Delivery OS + pack archive

## Success criteria
- [pack_created] Sam-Harness no.X with audit + execution-plan
