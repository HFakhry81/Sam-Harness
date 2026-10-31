# Sam-Harness — دليل تشغيل الوكالة (للاختبار الفعلي)

**الحالة:** جاهز لاختبار مسار **التحليل / المراجعة / الخطط التنفيذية** على أي PC.  
تنفيذ تعديلات كود العميل يحتاج **GO** صريح (`--go` / `IMPLEMENT_GO=1` / `go-nogo.json`).

يعمل على أي جهاز: Node.js + pnpm + Ollama محلي (+ اختياري Ollama Cloud عبر `.env`).

---

## 1) من هم الوكلاء لكل دور؟

| الدور | الوكيل | محلي/سحابي | ماذا يفعل |
| --- | --- | --- | --- |
| **CEO Router** | `ceo_router` | محلي | يصنّف المهمة: operational vs architecture |
| **Intake** | `intake` | محلي | ينشئ `engagement.json` للمشروع المستهدف |
| **Evidence Scout** | `evidence` | محلي $0 | يمسح المستودع ويكتب `evidence-pack.md` بمسارات حقيقية |
| **Strategist** | `strategist` | سحابي إن وُجد المفتاح وإلا محلي | يكتب `strategy-vN` ويدمج رفض المدقق |
| **Auditor** | `auditor` | سحابي/محلي | يوافق أو يرفض بأسباب + خطورة + حل (حتى 5 لفات LangGraph) |
| **Architect** | `architect` | سحابي/محلي | بعد APPROVED فقط: خطة + فجوات + backlog |
| **Help** | `help` | سحابي/محلي | مواصفة المساعدة داخل التطبيق |
| **Marketer** | `marketer` | سحابي/محلي | حملة صادقة بدون مبالغة |
| **Verifier** | `verifier` | محلي | يتحقق من الحزمة مقابل المهمة |
| **Delivery OS** | (نظام) | — | لوحة تذاكر + DoD + Go/No-Go |
| **Implementer** | `implementer` | سحابي/محلي | يلمس كود العميل **فقط بعد GO** |
| **Desktop Operator** | `operator` | محلي | مهام سطح المكتب الآمنة (L1) |

مصفوفة الأدوات التفصيلية تُولَّد من الكود: انظر `src/agency/capabilities.ts`.

---

## 2) كيف تسير خطة العمل بينهم؟

```text
task.ts / task.md
        │
        ▼
  CEO Router ──operational──► Operator (أدوات PC محدودة) ──► تحقق
        │
        └──architecture──► Intake → Evidence Scout
                                  │
                                  ▼
                         LangGraph Review Loop (≤5)
                         Strategist ↔ Auditor
                                  │
                    ┌─────────────┴─────────────┐
                    │ REJECTED                  │ APPROVED
                    │ merge fixes → next vN     ▼
                    │                    Architect → Help → Marketer → Verifier
                    │                                  │
                    │                                  ▼
                    │                         Delivery Board + PENDING Go/No-Go
                    │                                  │
                    └──────────► archive SAM_OUTPUT_HOME/reports/Sam-Harness no.X
                                                   │
                                      owner GO? ───┼─── NO → توقف (لا كود عميل)
                                                   └── YES → Implementer (L3)
```

**بوابتان إلزاميتان**
1. **Audit gate:** بدون `[APPROVED]` لا Architect ولا حزمة نجاح كاملة.  
2. **Go/No-Go:** بدون `GO` لا تنفيذ على مستودع العميل.

---

## 3) الصلاحيات وحدود القدرات على الكمبيوتر الحقيقي

### مسموح عموماً (حسب الدور)
| القدرة | من | حد |
| --- | --- | --- |
| قراءة ملفات المشروع المستهدف | evidence, auditor, strategist… | مسارات allowlist |
| كتابة تقارير في مجلد Sam-Harness / pack | strategist, architect, help, marketer | لا تلمس كود العميل |
| فتح/إنشاء/تعديل ملفات ومجلدات، نقل/نسخ، Excel | operator | ضمن allowlist عبر المنصات |
| حذف ملف/مجلد | operator | يتطلب `confirm:true` (+ `recursive` للمجلد غير الفارغ) |
| لقطة شاشة | operator | Windows حالياً |
| Shell محدود | operator / implementer | `dir`, `type`, `echo`, `where`, `Get-*` فقط |
| تعديل كود العميل | implementer | بعد **GO** + مستودع مصرّح |

**دورة Task:** نجاح → أرشفة + إفراغ المهمة (لا تكرار ناجح). فشل → الإبقاء لإعادة المحاولة بخطة أفضل.

### ممنوع على كل الأدوار
- مسارات النظام: `C:\Windows`, Program Files  
- أوامر تثبيت/حذف عشوائية، سكربتات غير مدرجة  
- تجاوز Go/No-Go أو المتابعة «بحذر» بعد رفض المدقق  
- اختراع مسارات كود غير موجودة في evidence

### جذور المسارات المسموحة
`cwd` (Sam-Harness)، Desktop، Documents، Downloads، مجلد المستخدم، `D:\`، `E:\`.

### نموذج المساحات (هجين عالمي)
| الوضع | يشبه | الحقل في UI |
| --- | --- | --- |
| **operator** | Claude Computer Use / OpenAI Operator / Power Automate / Zapier | لا مستودع واحد — `planSteps` + `roots[]` + Allowlist |
| **code** | Cursor / Devin / VS Code workspace | مستودع واحد `targetRepo` + `packDir` (+ multi-root لاحقاً) |

مصدر الحقيقة للتشغيل: `task.spec.json` (`workspaceMode`, `roots`, `planSteps`). ممنوع اختراع مسارات مثال (`Desktop/old.txt`).

---

## 4) كيف تختبر الآن (checklist)

### الطريقة الموصى بها — Control Plane UI
1. تأكد Ollama يعمل محلياً.  
2. شغّل من سطح المكتب `SamHarness.bat` → اختر **1** (الافتراضي)، أو:
   ```bash
   pnpm run ui
   ```
3. المتصفح يفتح على `http://127.0.0.1:8787/`  
4. اكتب المهمة → **معاينة Spec**. إن انخفضت الثقة تظهر أسئلة توضيح — أجب ثم **أكّد وأكمل المواصفة**.  
5. **احفظ وشغّل**: يُكتب `task.spec.json` (مصدر الحقيقة) + `task.ts`/`task.md` ثم التنفيذ.  
6. بعد الانتهاء: تقرير منسّق؛ نجاح → إفراغ Task؛ فشل → الإبقاء لإعادة المحاولة.  
7. تقييم جودة التوصيف: `pnpm run eval:task-spec` (عتبة ≥95%).

### CLI (بدون واجهة)
```bash
pnpm start -- --yes
pnpm start -- --yes --implement --go
```

Smoke بدون LLM:
```bash
pnpm run smoke:agency
pnpm run smoke:delivery
pnpm run smoke:capabilities
```

---

## 5) ماذا «جاهز للاختبار» يعني / لا يعني

| جاهز الآن | ليس جاهزاً بعد |
| --- | --- |
| Control Plane + Task Spec + operator multi-root | multi-root صريح لمسار code (أكثر من repo) |
| أدلة مسارات + بوابة تدقيق LangGraph | Evals أوسع لجودة المراجعات |
| Delivery board + Go/No-Go | مشغّل سطح مكتب غير محدود |
| تشغيل محمول على أي PC بـ Node/Ollama | تثبيت ذاتي كامل بدون إعداد مسبق |
