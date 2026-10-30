# التحكم بالجهاز وأدوات سطح المكتب

السؤال: هل تتحكم الوكالة بالجهاز المحلي وتنفّذ مهام ويندوز/أوبونتو اليومية؟  
**الجواب المختصر:** جزئياً — قوية على **Windows UIA**؛ على **Ubuntu/macOS** أدوات الملفات والبريد والمجدول تعمل، أما أتمتة سطح المكتب الرسومية فـ **غير منفّذة (stubs)**.

## أدوات المشغّل (operator)

من `OPERATOR_CAPABILITIES` + `registry.ts`:

| مجموعة | أدوات | حدود |
| --- | --- | --- |
| ملفات | `list_dir`, `read_file`, `write_file`, `mkdir`, `copy_file`, `move_file`, `delete_path`, `open_path` | جذور مسموحة؛ حذف يحتاج `confirm:true`؛ مسارات النظام ممنوعة |
| جداول | `write_excel` | XLS/CSV بسيط لا Excel كامل الميزات |
| لقطة بسيطة | `screenshot` | **Windows فقط** |
| صدفة | `run_shell` | بادئات بيضاء فقط — لا تثبيت عشوائي |
| عزل | `run_node_sandbox` | تُجرَّد الأسرار؛ مهلة؛ Docker اختياري |
| MCP | `mcp_call` | من `mcp.json` |
| سطح المكتب | `desktop_*` (نوافذ، UIA، إدخال، حافظة، حوار ملفات، لقطة، تحقق، وسائط، ffmpeg) | موافقات للأفعال الحساسة؛ dry-run؛ مفتاح قتل |

## خلفية سطح المكتب حسب OS

| المنصة | Backend | الواقع |
| --- | --- | --- |
| Windows | `windows-uia` (PowerShell + UIAutomation) | قائمة/تركيز/تشغيل تطبيقات/UIA/إدخال/حافظة/لقطات؛ اختياري مراقب Ctrl+Shift+Alt+K |
| Linux (Ubuntu وغيرها) | `linux-atspi-stub` | كل العمليات ترمي غير منفّذ |
| macOS | `macos-accessibility-stub` | غير منفّذ |
| اختبارات | `SAM_DESKTOP_BACKEND=mock` | يعمل على أي OS |

## صندوق الملفات (sandbox)

- السماح الافتراضي: المنزل، Desktop/Documents/Downloads، الأقراص المتاحة على ويندوز؛ على يونكس أيضاً `/tmp`, `/home`, `/media`, `/mnt`, `/Volumes`  
- التقييد: `WORKSPACE_ROOTS` أو `workspace-roots.json`  
- الرفض الدائم: System32، `/etc`، `.ssh`، ملفات الاعتماد، `.controlplane-token`، …  
- مخرجات الوكيل: `SAM_OUTPUT_HOME` (افتراضي `~/Documents/Sam-Harness`)

## البريد

- `EMAIL_PROVIDER=smtp` افتراضياً؛ dry-run حتى ضبط `SMTP_*`  
- أو `resend` + `RESEND_API_KEY`  
- الإرسال: مسودة → `APPROVE_COMMS=1` + موافقة واجهة/ثقة

## المجدول (Daily Ops)

- يعمل داخل Control Plane؛ فترة التكة `DAILY_OPS_TICK_MS` (افتراضي 30000)  
- التكة الافتراضية تسجّل ملخصاً في الدفتر — **تشغيل وكيل كامل** عبر زر Run / API وليس تلقائياً في كل تكة (**السلوك الحالي**)

## مهام يومية — ماذا يعمل أين؟

| مهمة يومية نموذجية | Ubuntu | Windows | macOS |
| --- | --- | --- | --- |
| نسخ/نقل ملفات ضمن المسموح | نعم | نعم | نعم |
| إنشاء Excel/نص | نعم | نعم | نعم |
| فتح مسار | نعم | نعم | نعم |
| لقطة شاشة أداة بسيطة | لا | نعم | لا |
| تشغيل تطبيق ونقر أزرار UIA | لا (stub) | نعم | لا (stub) |
| إرسال بريد بعد الموافقة | نعم إن ضُبط SMTP | نعم | نعم |
| مهمة مجدولة في Daily Ops | نعم (Control Plane يعمل) | نعم | نعم |
| PowerShell Get-* عبر run_shell | محدود/غير مناسب | نعم ضمن القائمة | محدود |

أعلام الأمان: `APPROVE_DESKTOP`, `SAM_DESKTOP_DRY_RUN`, `SAM_DESKTOP_PAUSED`, `SAM_DESKTOP_KILLED`, ملف `~/.sam-harness-desktop-kill`.
