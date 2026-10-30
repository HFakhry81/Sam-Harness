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

### Phase 4 — مشغّل سطح مكتب Windows ✅
1. UI Automation أولاً (PowerShell/.NET) مع لقطات تحقق/vision fallback.
2. نوافذ، لوحة مفاتيح/فأرة، حوارات ملفات، حافظة، `open_media` / `ffmpeg`.
3. موافقة لكل فعل destructive/financial/sending؛ dry-run؛ kill switch؛ تسجيل timeline.
4. اختبارات mock على كل OS + تكامل Notepad على `windows-latest`.

### Phase 5 — تكلفة شبه صفرية ✅
1. توجيه النماذج حسب صعوبة المهمة: محلي/مجاني أولاً → مدفوع عند الحاجة فقط (ثقة منخفضة، فشل تحقق، تعقيد صريح).
2. تخزين مؤقت للـ prompt/response (تطابق تام في SQLite) + تلميحات provider prompt-caching؛ ضغط السياق لتقليل التوكنات.
3. محاسبة دقيقة لكل تشغيل/يوم مربوطة بسقف Phase 1؛ تدهور لطيف للمحلي قرب السقف دون تجاوزه.
4. إعداد عبر env — انظر `docs/PHASE5_NEAR_ZERO_COST.md` و`.env.example`.

### Phase 6 — بوابات ثقة قابلة للإثبات ✅
1. بوابات جودة صريحة لكل خطوة (tests / typecheck / file assertions / desktop postconditions) — لا نجاح صامت؛ فشل → إعادة محاولة ثم تصعيد.
2. موافقات بشرية لأفعال خطرة (حذف خارج مجلد المخرجات، إرسال بريد، إنفاق فوق عتبة، سطح مكتب لتطبيقات حساسة) + سياسة `trust-policy.json` / env.
3. سجل تدقيق مُقيَّد بالتجزئة (hash chain) في SQLite + `pnpm run trust:verify` و`/api/trust/audit/verify`.
4. حزمة أدلة لكل تشغيل تحت `SAM_OUTPUT_HOME/runs/.../evidence/` + مرآة في `reports/`.
5. Control Plane `/api/trust/*` + CLI `trust:*` — انظر `docs/PHASE6_GATES_TRUST.md`.

### Phase 7 — توزيع عربي أولاً + تثبيت بنقرة ✅
1. i18n عربي افتراضي + RTL في Control Plane؛ إنجليزي كسقوط؛ `SAM_LOCALE` / `SAM_NUMERALS`.
2. توجيه لغة للوكلاء + تقارير RTL؛ فهم نوايا عربية/مصرية للمهام.
3. مثبت PowerShell (Windows) وshell (macOS/Linux) تكراري مع إلغاء تثبيت؛ `pnpm run doctor`.
4. انظر `docs/PHASE7_ARABIC_INSTALL.md`.

### بعد Phase 7 (Phase 8+)
- موصلات أوسع / حزم توزيع اختيارية (MSI).

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
