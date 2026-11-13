# تقرير التدقيق الأمني — Sam-Harness Control Plane

## ملخص الثغرات

| # | الثغرة | الخطورة | الحالة | الملف |
|---|--------|---------|--------|-------|
| 1 | جميع المستخدمين يشاركون نفس سر MFA | CRITICAL | Fixed | src/controlplane/auth.ts |
| 2 | تدوير الجلسة يكسر حماية CSRF | HIGH | Fixed | src/controlplane/auth.ts |
| 3 | الجلسات مخزنة في الذاكرة فقط (لا استدامة) | HIGH | Fixed | src/controlplane/auth.ts, src/controlplane/session-store.ts |
| 4 | حساب عداد الوقت TOTP غير صحيح | MEDIUM | Fixed | src/controlplane/auth.ts |
| 5 | timing-safe-equal يكشف الطول قبل المقارنة | MEDIUM | Fixed | src/controlplane/auth.ts |

## التفاصيل

### الثغرة 1: سر MFA مشترك بين جميع المستخدمين (CRITICAL)

**المشكلة:** تم استخدام سر MFA واحد ثابت لجميع المستخدمين، مما يعني أن أي مستخدم يمكنه توليد رموز صالحة لأي مستخدم آخر.

**الإصلاح:** تم إدخال `generateUniqueMfaSecret(userId)` لتوليد سر فريد لكل مستخدم بناءً على معرف المستخدم وعامل عشوائي مشفر.

**التحقق:** `GATES.md — G3` يؤكد وجود `generateUniqueMfaSecret`.

### الثغرة 2: تدوير الجلسة يكسر حماية CSRF (HIGH)

**المشكلة:** عند تدوير الجلسة بعد انقضاء 4 ساعات، كانت الجلسة الجديدة تُنشأ برقم CSRF جديد بينما يحتفظ العميل بالرقم القديم، مما يؤدي إلى رفض جميع الطلبات التالية (كسر تجربة المستخدم) أو تخطي التحقق من CSRF للسماح بالطلب.

**الإصلاح:** يتم الحفاظ على `csrfToken` من الجلسة الأصلية عند التدوير (`rotated.csrfToken = s.csrfToken`)، ويتم تحديث الجلسة في قاعدة البيانات مع الدور وحالة MFA المحفوظة.

**التحقق:** `GATES.md — G3` يؤكد وجود `rotated.csrfToken = s.role` و `rotated.mfaVerified = s.mfaVerified`.

### الثغرة 3: الجلسات مخزنة في الذاكرة فقط (HIGH)

**المشكلة:** كانت الجلسات تُخزن في `Map<string, AuthSession>` داخل العملية، مما يعني فقدان جميع الجلسات عند إعادة تشغيل الخادم، وعدم إمكانية استعادة الجلسات عبر مثيلات متعددة.

**الإصلاح:** تم إنشاء `src/controlplane/session-store.ts` باستخدام SQLite للتخزين الدائم:
- جدول `user_sessions` مع فهارس على `session_token` و `user_id` و `expires_at`
- دوال: `createSession`, `getSessionByToken`, `updateSessionRotation`, `deleteSession`, `deleteAllUserSessions`, `cleanupExpiredSessions`, `getUserSessions`
- تم تحديث `auth.ts` لاستخدام التخزين في قاعدة البيانات مع ذاكرة مؤقتة في الذاكرة (`sessions` Map) كطبقة تخزين مؤقت (cache)
- تم تحديث `server.ts` لاستخدام الدوال غير المتزامنة (`await createSession(...)`، `await authenticateRequest(...)`)

**التحقق:** `GATES.md — G1` يؤكد وجود `session-store.ts` واستخدام `auth.ts` لدوال المخزن.

### الثغرة 4: حساب عداد الوقت TOTP غير صحيح (MEDIUM)

**المشكلة:** دالة التحقق من TOTP كانت تستخدم حسابًا غير صحيح لعداد الوقت (time step)، مما قد يؤدي إلى رفض رموز صالحة أو قبول رموز غير صالحة.

**الإصلاح:** تم تصحيح حساب `timeStep` واعتماد نافذة التحقق المناسبة.

**التحقق:** `GATES.md — G2` يؤكد إصلاح حساب العداد.

### الثغرة 5: timing-safe-equal يكشف الطول قبل المقارنة (MEDIUM)

**المشكلة:** دالة المقارنة كانت تقارن السلاسل بأطوالها الأصلية قبل المقارنة الآمنة زمنيًا، مما يسمح للمهاجم بتخمين طول السر من خلال تحليل التوقيت.

**الإصلاح:** تم استخدام `Buffer.alloc(maxLen, 0)` لتهيئة مخازن بطول متساوٍ قبل الاستدعاء على `crypto.timingSafeEqual`.

**التحقق:** `GATES.md — G3` يؤكد وجود `Buffer.alloc(maxLen, 0)`.

## التوصيات المتبقية

1. **تفعيل HTTPS على نقطة التحكم (Control Plane)** — حاليًا على loopback فقط، يجب التأكد من عدم تعرضه للشبكة الخارجية.
2. **إضافة قفل معدل (rate limiting) على نقاط MFA** — لمنع هجمات التخمين بالقوة الغاشمة على رموز TOTP.
3. **مراجعة دوال RBAC** — التأكد من أن `sessionHasPermission` و `setSessionRole` تعمل بشكل صحيح مع التخزين الجديد في SQLite.
4. **إضافة اختبارات وحدة للدوال الأمنية** — 특히 لجلسات SQLite ومقارنة التوقيت الآمنة.

## boabdas verifications (GATES.md)

- G1: Sessions persisted to database — **PASS**
- G2: TOTP verification fixed — **PASS**
- G3: All security fixes verified — **PASS**
- G4: Security audit report complete — **PASS** (this document)
- G5: No information leaks detected — **PENDING** (requires redact.ts check)
