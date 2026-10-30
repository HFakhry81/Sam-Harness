# فهرس المساعدة — Sam-Harness

هذه المساعدة مبنية **حصراً** على الكود الحالي في `src/` و`scripts/` و`docs/` و`tests/`.  
أي قدرة مذكورة في خارطة الطريق وغير منفّذة تُعلَّم صراحةً: **مخطط / غير منفّذ بعد**.

## كيف تستخدم المساعدة

- من الطرفية: `pnpm run help` أو `pnpm run help workflow`
- من لوحة التحكم: تبويب **المساعدة** (بحث + مواضيع)
- عبر الواجهة البرمجية: `GET /api/help` و`GET /api/help/:topic`
- تصدير ملف تعريف الوكالة: `pnpm run help:export` → `SAM_OUTPUT_HOME/documents/help` و`dist/help`
- للوكلاء: نية «مساعدة / help» تُجاب من هذه الوثائق

## أسئلة المالك → المواضيع

| سؤال المالك | الموضوع |
| --- | --- |
| ١) خطة سير العمل والأدوار والمخططات | [`workflow`](workflow.md) |
| ٢) أي وكلاء/نماذج لكل دور | [`agents-models`](agents-models.md) |
| ٣) الاختيار حسب نظام التشغيل والتوصيل | [`selection-wiring`](selection-wiring.md) |
| ٤) محلي / سحابة / هجين والسقف $0.50 | [`hybrid-mode`](hybrid-mode.md) |
| ٥) التخصص وحدود القدرات | [`specialty-capabilities`](specialty-capabilities.md) |
| ٦) التحكم بالجهاز وأدوات سطح المكتب | [`desktop-control`](desktop-control.md) |
| ٧) تعديل سير العمل والفريق (جدول + محرّر رسومي مرحلة 9) | [`customize`](customize.md) |
| تثبيت | [`install`](install.md) |
| أمان / موافقات / تدقيق | [`security`](security.md) |
| تكلفة | [`cost`](cost.md) |
| استكشاف أخطاء (doctor) | [`troubleshooting`](troubleshooting.md) |
| أسئلة شائعة | [`faq`](faq.md) |
| قاموس | [`glossary`](glossary.md) |

## جملة واحدة عن المنتج

Sam-Harness وكالة هجينة عربية-أولاً: **لوحة تحكم** + **مراجعة LangGraph** + **مشغّل سطح مكتب (ويندوز فعلي)** + حزم تقارير مرقّمة تحت مجلد الإخراج. ليست منشئ مواقع عام، وليست أتمتة سطح مكتب كاملة على لينكس/ماك.
