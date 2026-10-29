# Sam-Harness — Production Hardening (P0 → الهدف)

**الهدف:** وكالة هجينة متعددة الاستخدامات جاهزة لإنتاج داخلي موثوق (UpNexa)، ثم توسيع لعزل عملاء متعددين.

**الوضع:** منصة واعدة (Control Plane + LangGraph + مشغّل سطح مكتب + ذاكرة)، لكن ليست بعد بمستوى الوكالات العالمية في الموثوقية والعزل.

## فجوات حرجة (مما رُصد تشغيلياً)

| # | فجوة | أثر | حالة |
| --- | --- | --- | --- |
| 1 | افتراضي UI/Spec → Maw3ed حتى لمهام Sam-Harness الذاتية | حزم في المستودع الخطأ | ✅ إصلاح جارٍ |
| 2 | تلوث هدف عند استبدال task أثناء تشغيل | فشل تدقيق / هدف خاطئ | ✅ منع الكتابة أثناء التشغيل |
| 3 | ذاكرة تُكتب ولا تُحقن في CEO/Strategist | لا اكتساب خبرة فعلي | ✅ حقن أساسي |
| 4 | goal-fidelity عربي / نفي BookingType | رفض خاطئ أو قبول ضعيف | ✅ تحسين + evals |
| 5 | review-loop قديم يتسرب للمهمة التالية | ضوضاء/انحراف أول لفة | ✅ مسح قبل التشغيل |
| 6 | لا بوابة صلبة تمنع docsRoot أجنبي لمهام الذات | خطر تكرار خطأ Maw3ed | ✅ حراسة runner |
| 7 | نقص evals انحدار لمسار الحزم/الذات | رجوع الصدوع | ✅ `smoke:prod-gates` 4/4 |
| 8 | عزل عملاء / ملفات اعتماد متعددة | غير جاهز لـ multi-tenant | لاحقاً P1 |
| 9 | موصلات إيميل حقيقية + جدولة Daily Ops | جزئي stubs | لاحقاً P1 |
| 10 | snapshots rollback ثنائية | journal فقط | لاحقاً P1 |

## تعريف «جاهز للإنتاج الداخلي»

1. `pnpm run smoke:prod-gates` يمر 100٪ على الجهاز المرجعي.
2. مهمة «عن نفسك» أو Control Plane لا تكتب أبداً تحت `maw3ed\docs`.
3. دروس `lesson:*` تظهر في سياق Strategist/CEO في كل تشغيل architecture/ops.
4. لا يُستبدل `task.ts` أثناء `running`.
5. fidelity لا يرفض استراتيجية على الموضوع بسبب ذكر نهي BookingType.

## سباق التنفيذ الحالي (P0b)

1. وثيقة الفجوات (هذا الملف).
2. Evals: self-report targetRepo/packDir + Arabic fidelity + no-booking false drift.
3. حراسة runner: إن كان الهدف ذاتياً و`docsRoot` تحت عميل أجنبي → إعادة توجيه إلى `cwd/docs`.
4. حقن `learningContextBlock` في brief architecture.
5. سكربت `smoke:prod-gates` يجمع evals الحرجة.

## بعد P0b (P1 إنتاج موسّع)

- عزل ملفات لكل عميل (memory/ledger/packs).
- جدولة Daily Ops حقيقية.
- SMTP/إشعارات بموافقة.
- لقطات rollback قبل Level-3.
- لوحة مقاييس: نسبة APPROVED، تكلفة، زمن أول حزمة.
