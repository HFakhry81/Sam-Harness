# Phase 9 — Visual workflow editor

**الهدف / Goal:** محرّر رسومي (SVG، بدون CDN) لسير عمل الوكالة فوق أساسات المرحلة 8 (`config/team.json`، CRUD الأدوار، ترتيب المسار، سجل التدقيق، i18n).

---

## 1) Canvas

| عنصر | السلوك |
| --- | --- |
| الصفحة | Control Plane → **المسار الرسومي** / **Workflow graph** (عربي RTL افتراضياً) |
| المكتبة | SVG مضمّن في `workflow-editor.js` — بدون React Flow / بدون CDN وقت التشغيل |
| العقد | Router، Operational، Intake، Evidence، Review (strategist↔auditor)، GO Gate، المتخصصون، Delivery، Level-3 |
| السحب | سحب العقد + تحريك اللوحة؛ Ctrl/⌘+عجلة للتكبير |
| الشارات | توجيه حي لكل دور من `GET /api/routing/effective` (local / paid / free، يراعي السقف) |

---

## 2) التحرير والثوابت

- إعادة ترتيب خطوات المتخصصين بعد GO (Move earlier/later أو استيراد ترتيب).
- إضافة أدوار مخصّصة، تفعيل/تعطيل، حذف المخصّص فقط.
- لوحة جانبية: `prompt`، نماذج local/cloud/free، `prefersCloud`، أدوات/قدرات — مع تحقق في الواجهة والخادم.
- **مقفلة:** حلقة المراجعة وبوابة GO (لا حذف، لا تجاوز، لا إعادة ترتيب غير قانونية). أخطاء واضحة في اللوحة.

---

## 3) مسودة مقابل تطبيق · تراجع · استيراد

| إجراء | الأثر |
| --- | --- |
| حفظ مسودة | تحقق خادم (`draft: true`) + تخزين محلي؛ **لا** يكتب `team.json` |
| تطبيق على الفريق | `PUT /api/workflow/graph` → `saveTeamConfig` + تدقيق `workflow_graph.apply` / `team_config.save` |
| تراجع / إعادة | مكدس محلي (`WorkflowHistory`) |
| تصدير / استيراد JSON | حزمة `{ graph, layout }`؛ الاستيراد يبدأ كمسودة ما لم `apply: true` |
| افتراضي | `POST /api/workflow/reset` |

مصادقة المالك (Phase 1) مطلوبة. سجل التدقيق Phase 6 يسجّل التطبيق/الاستيراد/التخطيط. موافقات HITL Phase 6 تبقى سارية للأفعال الخطرة (سطح مكتب / بريد / إنفاق) — تعديل الفريق عبر توكن المالك فقط.

---

## 4) التخطيط منفصل عن الدلالة

- الدلالة: `config/team.json` (عبر تحويل الرسم البياني).
- التخطيط: `config/workflow-layout.json` (`positions` فقط) عبر `GET/PUT /api/workflow/layout`.

---

## 5) واجهات API

| Endpoint | الدور |
| --- | --- |
| `GET /api/workflow` | graph + layout + team + routing |
| `POST /api/workflow/validate` | ثوابت الرسم + معاينة team |
| `PUT /api/workflow/graph` | تطبيق أو مسودة (`draft`) |
| `GET/PUT /api/workflow/layout` | مواضع العقد |
| `POST /api/workflow/reset` | افتراضيات الفريق + التخطيط |
| `POST /api/workflow/import` | استيراد JSON |

---

## 6) اختبارات

```bash
pnpm test -- tests/phase9-workflow-editor.test.ts
```

يغطي: round-trip graph↔config، ثوابت الخادم، تخطيط منفصل، undo/redo، حفظ/تحميل API.

---

## ملفات رئيسية

```text
src/agency/workflowGraph.ts
src/agency/workflowLayout.ts
src/agency/workflowHistory.ts
src/controlplane/public/workflow-editor.js
src/controlplane/public/index.html   # stageWorkflow
src/controlplane/server.ts           # /api/workflow*
docs/help/{ar,en}/customize.md
docs/help/{ar,en}/workflow.md
tests/phase9-workflow-editor.test.ts
```
