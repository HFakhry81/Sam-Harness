# توصيات الأمان — Sam-Harness

**المنصة:** Sam-Harness — وكالة ذكاء اصطناعي هجينة  
**اللغة:** العربية  
**الهدف:** إصلاح الثغرات الأمنية المكتشفة في الكود والتوثيق.

---

## 1. المصادقة والصلاحيات (Authentication & Authorization)

### 1.1 تشفير توكن لوحة التحكم
**المشكلة:** التوكن مخزن بنص عادي في `.controlplane-token`.  
**الحل:**
- تشفير التوكن باستخدام `crypto.createCipheriv` مع مفتاح مشتق من متغير بيئة (`CONTROL_PLANE_ENCRYPTION_KEY`).
- تخزين المفتاح في متغيرات بيئة فقط، وليس في الملفات.
- تدوير التوكن تلقائياً كل 30 يوماً.

```typescript
// مثال للتشفير
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
const key = crypto.scryptSync(process.env.CONTROL_PLANE_ENCRYPTION_KEY, "salt", 32);
const iv = randomBytes(16);
const cipher = createCipheriv("aes-256-cbc", key, iv);
```

### 1.2 المصادقة متعددة العوامل (MFA)
**المشكلة:** لا يوجد دعم لـ MFA.  
**الحل:**
- إضافة TOTP (Time-based One-Time Password) باستخدام مكتبة `otplib`.
- تفعيل MFA للعمليات الحساسة: تنفيذ الكود (Level-3)، إرسال الإيميل، حذف البيانات.
- دعم WebAuthn للمستخدمين المتقدمين.

### 1.3 إدارة الجلسات (Session Management)
**المشكلة:** جلسات في `Map` في الذاكرة بدون تدوير، TTL 12 ساعة ثابتة.  
**الحل:**
- تدوير الجلسات تلقائياً كل 4 ساعات.
- حد أقصى للجلسات النشطة لكل مستخدم (مثل 5 جلسات).
- تنظيف الجلسات المنتهية الصلاحية تلقائياً.
- تخزين الجلسات في SQLite بدلاً من الذاكرة فقط للاستمرارية.

### 1.4 نظام RBAC متقدم
**المشكلة:** عزل العميل أساسي فقط (tenant=local).  
**الحل:**
- أدوار محددة: Owner, Admin, Agent, Viewer, Client.
- صلاحيات دقيقة لكل وكيل (Strategist, Auditor, Architect, …).
- فحص الصلاحية قبل كل إجراء (middleware).

---

## 2. حماية البيانات (Data Protection)

### 2.1 تشفير قاعدة بيانات SQLite
**المشكلة:** SQLite غير مشفر عند السكون.  
**الحل:**
- استخدام SQLCipher لتشفير قاعدة البيانات بالكامل.
- تشفير الحقول الحساسة على مستوى التطبيق (مفاتيح API، توكنات، بيانات العملاء).
- إدارة مفاتيح التشفير عبر Vault خارجي أو متغيرات بيئة آمنة.

### 2.2 عزل مفاتيح API
**المشكلة:** مفاتيح في `.env` متاحة لجميع العمليات.  
**الحل:**
- تخزين المفاتيح في متغيرات بيئة منفصلة لكل عملية.
- استخدام مدير أسرار (Secret Manager) في البيئات الإنتاجية.
- تقييد الوصول للمفاتيح فقط للعمليات التي تحتاجها.

### 2.3 سياسة منع فقدان البيانات (DLP)
**المشكلة:** keine سياسة DLP.  
**الحل:**
- فحص المحتوى المنقول (إيميلات، ملفات) للبيانات الحساسة (أرقام هواتف، بطاقات ائتمان، هوية وطنية).
- منع إرسال البيانات الحساسة عبر الإيميل بدون تشفير.
- تسجيل جميع عمليات نقل البيانات في سجل التدقيق.

### 2.4 نسخ احتياطي مشفر
**المشكلة:** keine نسخ احتياطي تلقائي.  
**الحل:**
- نسخ احتياطي تلقائي يومي لقاعدة بيانات SQLite.
- تشفير النسخ الاحتياطية قبل رفعها للسحابة.
- اختبار الاستعادة التلقائي شهرياً.

---

## 3. أمن الشبكة (Network Security)

### 3.1 فرض TLS محلياً
**المشكلة:** keine فرض TLS لواجهة API المحلية.  
**الحل:**
- فرض TLS لكل اتصالات Control Plane المحلية.
- استخدام شهادات موقعة ذاتياً للتطوير، وشهادات موثوقة للإنتاج.
- redirect HTTP إلى HTTPS تلقائياً.

### 3.2 سياسة CORS صارمة
**المشكلة:** سياسة CORS قد تكون مرنة.  
**الحل:**
- تقييد CORS لنطاقات محددة فقط (localhost للنظام المحلي).
- منع `*` في 환경 الإنتاج.
- السماح فقط بالطرق المطلوبة (GET, POST, PUT, DELETE).

### 3.3 تحديد المعدل (Rate Limiting)
**المشكلة:** keine Rate Limiting.  
**الحل:**
- تحديد عدد الطلبات لكل مستخدم لكل دقيقة (مثل 100 طلب/دقيقة).
- تحديد عدد الطلبات لكل نقطة نهاية (API endpoint).
- حظر عناوين IP المشبوهة تلقائياً.

### 3.4 جدار حماية للتطبيقات (WAF)
**المشكلة:** keine WAF.  
**الحل:**
- إضافة WAF للكشف عن SQL Injection, XSS, CSRF.
- حظر الطلبات الخبيثة تلقائياً.
- تسجيل الهجمات في سجل التدقيق.

---

## 4. الثغرات على مستوى الكود (Code-Level Fixes)

### 4.1 sandbox.ts — إصلاح حقن الأوامر (Command Injection)

**المشكلة:** استخدام `child_process.spawn` و `execFileSync` مع مدخلات قد تكون خبيثة.  
**الحل:**

```typescript
// قائمة الأوامر المسموح بها فقط
const ALLOWED_COMMANDS = ["node", "npm", "pnpm", "tsx", "git"];

function validateCommand(cmd: string[]): boolean {
  if (cmd.length === 0) return false;
  if (!ALLOWED_COMMANDS.includes(cmd[0])) return false;
  // منع الأوامر الخطيرة
  const dangerous = ["rm", "del", "format", "fdisk", "mkfs", "shutdown", "reboot"];
  return !cmd.some(part => dangerous.includes(part.toLowerCase()));
}

// تشغيل معزول مع تحديد الموارد
const child = spawn(process.execPath, nodeArgs, {
  cwd: tempDir,
  env: scrubbedEnv,
  timeout: 30000, // مهلة 30 ثانية
  maxBuffer: 10 * 1024 * 1024, // 10 MB حد للمخرجات
  stdio: ["ignore", "pipe", "pipe"],
});
```

**الإضافات:**
- عزل شبكة الساندبوكس (لا وصول خارجي).
- تشغيل الحاويات Docker بوضع غير جذري (non-root user).
- تحديد موارد الحاوية (CPU, Memory, Disk).

### 4.2 Control Plane — إصلاح XSS و CSRF

**XSS:**
- تنظيف 모든 المخرجات قبل عرضها في واجهة المستخدم.
- تطبيق سياسة Content Security Policy (CSP) صارمة:
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
  ```
- استخدام `textContent` بدلاً من `innerHTML` في JavaScript.

**CSRF:**
- توكن CSRF فريد لكل جلسة.
- التحقق من Referer header في طلبات الحالة الحساسة.
- استخدام SameSite=Strict لملفات تعريف الارتباط (cookies).

```typescript
// مثال للتحقق من CSRF
export function validateCSRF(req: IncomingMessage, session: AuthSession): boolean {
  const token = req.headers[CSRF_HEADER] as string;
  return timingSafeEqualString(token, session.csrfToken);
}
```

### 4.3 إصلاح تسرب الذاكرة (Memory Leak)

**المشكلة:** `Map` للجلسات في الذاكرة لا يُنظف.  
**الحل:**

```typescript
// تنظيف تلقائي للجلسات المنتهية
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000); // كل ساعة

// حد أقصى للجلسات
if (sessions.size >= MAX_SESSIONS) {
  // حذف أقدم جلسة
  const oldestKey = sessions.keys().next().value;
  sessions.delete(oldestKey);
}
```

### 4.4 إصلاح حقن SQL (SQL Injection)

**المشكلة:** استعلامات SQL動ية محتملة.  
**الحل:**
- استخدام استعلامات معلماتة (parameterized queries) فقط:
  ```typescript
  // خطأ: db.run(`SELECT * FROM users WHERE id = ${userId}`);
  // صحيح: db.run("SELECT * FROM users WHERE id = ?", [userId]);
  ```
- التحقق من صحة جميع المدخلات قبل استخدامها في الاستعلامات.
- استخدام ORM يدعم الاستعلامات المعلماتة تلقائياً.

---

## 5. مراقبة وتسجيل الأمان (Security Monitoring & Audit)

### 5.1 سجل التدقيق المقاوم للتلاعب (Tamper-evident Audit Log)
- استخدام سلسلة تشفيرية (hash chain) لكل إدخال في سجل التدقيق.
- تسجيل جميع العمليات الحساسة: تسجيل دخول، تنفيذ كود، إرسال إيميل، حذف بيانات.
- تنبيه تلقائي عند اكتشاف عمليات مشبوهة.

### 5.2 التنبيهات الأمنية
- تنبيه عند فشل محاولات تسجيل الدخول المتكررة.
- تنبيه عند تنفيذ كود خارج الساندبوكس.
- تنبيه عند محاولة الوصول لبيانات دون صلاحية.

---

## 6. قائمة التحقق من التنفيذ (Security Checklist)

| # | العنصر | الحالة | الأولوية |
|---|--------|--------|----------|
| 1 | تشفير توكن لوحة التحكم | لم ينفذ | عالية |
| 2 | إضافة MFA للعمليات الحساسة | لم ينفذ | عالية |
| 3 | تدوير الجلسات تلقائياً | لم ينفذ | متوسطة |
| 4 | نظام RBAC متقدم | لم ينفذ | متوسطة |
| 5 | تشفير SQLite | لم ينفذ | عالية |
| 6 | عزل مفاتيح API | لم ينفذ | عالية |
| 7 | سياسة DLP | لم ينفذ | متوسطة |
| 8 | نسخ احتياطي مشفر | لم ينفذ | منخفضة |
| 9 | فرض TLS محلياً | لم ينفذ | عالية |
| 10 | سياسة CORS صارمة | لم ينفذ | متوسطة |
| 11 | تحديد المعدل (Rate Limiting) | لم ينفذ | عالية |
| 12 | جدار حماية للتطبيقات (WAF) | لم ينفذ | منخفضة |
| 13 | إصلاح sandbox.ts (command injection) | لم ينفذ | عالية |
| 14 | إصلاح XSS في واجهة التحكم | لم ينفذ | عالية |
| 15 | إصلاح CSRF في Control Plane | لم ينفذ | عالية |
| 16 | إصلاح تسرب الذاكرة | لم ينفذ | متوسطة |
| 17 | إصلاح حقن SQL | لم ينفذ | عالية |
| 18 | سجل التدقيق المقاوم للتلاعب | موجود (Phase 6) | موجودة |
| 19 | التنبيهات الأمنية | لم ينفذ | متوسطة |
