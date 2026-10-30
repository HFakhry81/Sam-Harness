# Phase 7 — Arabic-first experience & one-click install

**الهدف / Goal:** تجربة عربية أولاً (واجهة RTL + فهم نوايا عربية) مع تثبيت بنقرة واحدة على Windows وmacOS/Linux، بالإضافة إلى `pnpm run doctor`.

---

## العربية أولاً / Arabic-first

| موضوع | السلوك |
| --- | --- |
| اللغة الافتراضية | **العربية** (`SAM_LOCALE=ar`) مع سقوط إنجليزي للمفاتيح الناقصة |
| الاتجاه | `dir=rtl` / `lang=ar-EG` في لوحة التحكم |
| الأرقام | `SAM_NUMERALS=eastern` (١٢٣) افتراضياً للعربية؛ `western` للاتينية |
| اللهجة | نصوص واجهة ودّية فصحى/مصرية خفيفة (`SAM_EGYPTIAN_FRIENDLY=1`) |
| الوكلاء | توجيه لغة يُحقَن في مطالبات الوكالة (`languageSystemDirective`) |
| التقارير | غلاف Markdown RTL + خطوط عربية لأدلة التشغيل عند `contentLocale=ar` |
| النوايا | فهم طلبات مثل: اعمل/سوّي ملف، انقل، شيل/احذف، حلّل، طبّق |

### المتغيرات / Env

| Variable | Default | Purpose |
| --- | --- | --- |
| `SAM_LOCALE` | `ar` | لغة الواجهة والمحتوى |
| `SAM_UI_LOCALE` | _(← SAM_LOCALE)_ | تجاوز لغة الواجهة فقط |
| `SAM_CONTENT_LOCALE` | _(← SAM_LOCALE)_ | لغة ردود الوكيل والتقارير |
| `SAM_NUMERALS` | `eastern` (إن كانت العربية) | أرقام شرقية أو غربية |
| `SAM_EGYPTIAN_FRIENDLY` | `1` | صياغة مصرية ودّية في التوجيهات |

### واجهات البرمجة / APIs

| Endpoint | Role |
| --- | --- |
| `GET /api/locale` | إعداد اللغة + كتالوج الرسائل (عام — لصفحة الدخول) |
| `GET /api/i18n?locale=en` | رسائل لغة محددة |
| `POST /api/locale` | تبديل لغة العملية الحالية `{ locale, numerals? }` |

### الكود / Code

```text
src/lib/i18n/
  config.ts messages.ts rtl.ts format.ts prompts.ts documents.ts index.ts
src/controlplane/public/  — data-i18n + مبدّل اللغة
```

اختبارات التغطية ترفض أي مفتاح موجود في `ar` وغير موجود في `en` (والعكس).

---

## التثبيت بنقرة / One-click install

### Windows

```bat
scripts\install\install.cmd
:: أو
powershell -ExecutionPolicy Bypass -File scripts\install\install.ps1
powershell -ExecutionPolicy Bypass -File scripts\install\install.ps1 -NonInteractive -RegisterStartup
```

يقوم بـ: التحقق من Node + تفعيل Corepack/pnpm · `pnpm install` · إنشاء `.env` من `.env.example` مع أسئلة (لغة/أرقام/منفذ) · إنشاء `Documents\Sam-Harness` · مهمة مجدولة اختيارية عند تسجيل الدخول · `pnpm run doctor`.

إلغاء التثبيت:

```bat
powershell -File scripts\install\uninstall.ps1
powershell -File scripts\install\uninstall.ps1 -RemoveEnv -PurgeData
```

### macOS / Linux

```bash
bash scripts/install/install.sh
bash scripts/install/install.sh --non-interactive --register-startup
bash scripts/install/uninstall.sh
```

على macOS: LaunchAgent · على Linux: وحدة systemd للمستخدم.

السكربتات **تكرارية (idempotent)** وتعيد استخدام `.env` الموجود دون الكتابة فوق القيم غير الفارغة.

مساعدات TypeScript (للاختبارات والسكربتات): `src/lib/install/`.

---

## Doctor

```bash
pnpm run doctor
pnpm run doctor -- --json
```

يفحص محلياً (بدون شبكة): Node ≥20، pnpm/`packageManager`، `.env`، `node_modules`، `task.ts`، `SAM_OUTPUT_HOME`، تغطية i18n، وتلميح Ollama اختياري.

---

## الاختبارات / Tests

`tests/i18n-install.test.ts` — تغطية الترجمة، RTL، الأرقام، النوايا العربية، doctor، إنشاء `.env` ومجلد المخرجات — **بدون شبكة**.

يجب أن يمر على `ubuntu-latest` و`windows-latest`.

---

## قرارات المالك / Owner decisions

| قرار | القيمة |
| --- | --- |
| اللغة الافتراضية | العربية |
| مجلد المخرجات | `~/Documents/Sam-Harness` |
| التثبيت | PowerShell + shell (لا مثبت MSI إلزامي في هذه المرحلة) |
| Doctor | محلي / بدون شبكة في الوضع الافتراضي |
