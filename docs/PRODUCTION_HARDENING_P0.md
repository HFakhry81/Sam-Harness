# Sam-Harness — Production Hardening (P0 → الهدف)

**الهدف:** وكالة هجينة متعددة الاستخدامات جاهزة لإنتاج داخلي موثوق (UpNexa)، ثم توسيع لعزل عملاء متعددين.

**الوضع (بعد Phase 3 — التشغيل الإنتاجي):** Control Plane محمي بتوكن مالك + CSRF، صندوق ملفات، سقف تكلفة مفروض، SQLite مدمج (Postgres اختياري)، تشغيلات قابلة للاستئناف + checkpointer، عزل عملاء أولي، ومراقبة (pino/OTel/`/healthz`). الاستخدام الافتراضي ما زال مالكاً واحداً (`tenant=local`).

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
| 8 | عزل عملاء / ملفات اعتماد متعددة | عزل tenant_id + مجلدات workspaces | ✅ Phase 3 groundwork |
| 9 | موصلات إيميل حقيقية + جدولة Daily Ops | SMTP/Resend/dry-run + مجدول cron | ✅ Phase 2 |
| 10 | snapshots rollback | journal + git branch/commit snapshots | ✅ Phase 2 |
| 11 | Control Plane بلا مصادقة | أي عملية محلية تشغّل المهام | ✅ Phase 1 — توكن مالك + جلسة + CSRF + Host/Origin |
| 12 | أمان مسارات الأدوات | سطح هجوم / أو تقييد زائد | ✅ Phase 1 — بيئة مستخدم افتراضية + DENY حساس + `WORKSPACE_ROOTS`/`WORKSPACE_DENY` |
| 13 | سقف تكلفة محفوظ وغير مفروض | تجاوز ميزانية سحابية | ✅ Phase 1/3 — ledger في DB + إيقاف السحابة؛ افتراضي $0.50 |
| 14 | مخرجات الوكيل متفرقة في cwd | فوضى ملفات | ✅ Phase 1 — `SAM_OUTPUT_HOME` ≈ Documents/Sam-Harness |

## تعريف «جاهز للإنتاج الداخلي»

1. `pnpm run smoke:prod-gates` يمر 100٪ على الجهاز المرجعي.
2. مهمة «عن نفسك» أو Control Plane لا تكتب أبداً تحت `maw3ed\docs`.
3. دروس `lesson:*` تظهر في سياق Strategist/CEO في كل تشغيل architecture/ops.
4. لا يُستبدل `task.ts` أثناء `running`.
5. fidelity لا يرفض استراتيجية على الموضوع بسبب ذكر نهي BookingType.
6. كل مسار `/api/*` (ما عدا login/status/logout) يتطلب جلسة أو Bearer؛ Origin أجنبي → 403.
7. الأدوات تبلغ بيئة المستخدم مع منع المسارات الحساسة؛ `WORKSPACE_ROOTS` يقيّد عند الحاجة.
8. `costCapUsd = 0` (أو ميزانية مستنفدة) يمنع الاستدعاء السحابي برسالة واضحة؛ الافتراضي $0.50.
9. حزم الذات ومخرجات التشغيل تُوجَّه إلى `SAM_OUTPUT_HOME` (Documents/Sam-Harness).

## سباق التنفيذ

### Phase 0 — تثبيت الأساس ✅
typecheck + Vitest + CI (ubuntu/windows) + smokes محمولة.

### Phase 1 — الأمان والتكلفة ✅ (هذا الإصدار)
1. مصادقة Control Plane: `CONTROL_PLANE_TOKEN` أو `.controlplane-token` مولَّد، مقارنة ثابتة الزمن، كوكي جلسة + CSRF، ربط 127.0.0.1.
2. صندوق ملفات بأسلوب مشغّل سطح المكتب: بيئة المستخدم الافتراضية (منزل + مجلدات شائعة + محركات متاحة) مع قائمة DENY للمسارات الحساسة؛ `WORKSPACE_ROOTS` يضيّق و`WORKSPACE_DENY` يوسّع المنع؛ تطبيع + realpath/symlink؛ مخرجات الوكيل تحت `~/Documents/Sam-Harness` (`SAM_OUTPUT_HOME`).
3. فرض سقف التكلفة: دفتر يومي/لكل تشغيل حسب النموذج، حجب السحابة، عرض في UI (قسم الهجين). الافتراضي **$0.50/يوم** (`$0` = منع السحابة).

### Phase 2 — سد فجوات الوثائق ✅
1. Level-3 عام عبر `level3-plan.json` (لا hardcode لمنتج عميل) + فرع git وrollback عند فشل الاختبار.
2. عميل MCP (`src/tools/mcp.ts`) من `mcp.json` — stdio + HTTP؛ الأدوات عبر مصفوفة الصلاحيات؛ بدون تسريب أسرار للبيئة.
3. `run_node_sandbox` — عملية فرعية بمهلة/ذاكرة تحت `SAM_OUTPUT_HOME/temp/runs`؛ Docker اختياري (`SAM_SANDBOX_DOCKER=1`).
4. إيميل حقيقي: SMTP (nodemailer) و/أو Resend؛ dry-run إن لم يُضبط؛ موافقة مالك إلزامية.
5. مجدول Daily Ops ثابت في `daily-ops.json` مع سجل تحت `runs/daily-ops/`.

### Phase 3 — التشغيل الإنتاجي ✅
1. طبقة تخزين SQLite (`node:sqlite`) تحت `SAM_OUTPUT_HOME/state/` + استيراد JSON لمرة واحدة + نسخ احتياطي؛ `DATABASE_URL` لـ Postgres اختياري.
2. تشغيلات دائمة + LangGraph checkpointer + استئناف/إلغاء/إعادة محاولة.
3. عزل عملاء أولي (`SAM_TENANT_ID`، مجلدات `workspaces/<id>/`، سقف تكلفة لكل tenant).
4. pino + OTel اختياري + مقاييس + خط زمني في UI + `/healthz`.
5. `EMAIL_PROVIDER=smtp` افتراضياً (dry-run حتى ضبط SMTP).

### بعد Phase 3 (Phase 4+)
- موافقة بشرية موسّعة على أفعال مدمرة (الحذف خارج مساحة الوكيل ما زال عبر confirm + مصفوفة الأدوار).
- مشغّل سطح مكتب Windows، تكلفة شبه صفرية، بوابات ثقة، توزيع عربي.

## قرارات المالك (مُثبَّتة في هذا الفرع)

| قرار | القيمة المعتمدة |
| --- | --- |
| وصول الملفات | بيئة المستخدم الافتراضية + DENY للحساس؛ `WORKSPACE_ROOTS` للتقييد و`WORKSPACE_DENY` للامتداد |
| مجلد مخرجات الوكيل | `~/Documents/Sam-Harness` (`SAM_OUTPUT_HOME`) مع `reports/ documents/ exports/ runs/ memory/ temp/` |
| سقف التكلفة اليومي | **$0.50** افتراضياً؛ `$0` = منع السحابة بالكامل |
| مصدر التوكن | ملف محلي مولَّد أو `CONTROL_PLANE_TOKEN` في `.env` |
| مزود الإيميل | **SMTP** — `EMAIL_PROVIDER=smtp` افتراضياً؛ dry-run حتى ضبط `SMTP_*`؛ Resend عبر `EMAIL_PROVIDER=resend` |
| قاعدة البيانات | SQLite مدمج افتراضياً؛ Postgres اختياري عبر `DATABASE_URL` |
| التتبع | OpenTelemetry فقط (مُصدِّر اختياري عبر env) |
| عزل التنفيذ | عملية فرعية مقيدة افتراضياً؛ Docker اختياري عند التوفر |
| خوادم MCP الأولى | ابدأ من `mcp.example.json`؛ أضف الخوادم المطلوبة في `mcp.json` (غير مُلتزَم إن حوى أسراراً) |
