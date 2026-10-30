# التحكم بالجهاز وأدوات سطح المكتب

السؤال: هل تستطيع الوكالة التحكم بالجهاز المحلي ومهام Windows / Ubuntu اليومية؟  
**جواب مختصر:** نعم ضمن القوائم البيضاء — **Windows UIA** الأقوى؛ **Ubuntu/Linux** و**macOS** لهما خلفيات حقيقية تتهاوى بأمان عند غياب الأدوات.

## أدوات المشغّل

| المجموعة | الأدوات | الحدود |
| --- | --- | --- |
| ملفات | `list_dir`, `read_file`, `write_file`, … | جذور مسموحة؛ الحذف يحتاج `confirm:true` |
| جداول | `write_excel` | بسيط — ليس Excel كاملاً |
| لقطة | `screenshot` | Windows GDI · Linux grim/scrot/gnome-screenshot · macOS screencapture |
| صدفة | `run_shell` | قائمة بيضاء — bash على يونكس، PowerShell/cmd على Windows |
| صندوق رمل | `run_node_sandbox` | أسرار مُزالة؛ مهلة؛ Docker اختياري |
| MCP | `mcp_call` | من `mcp.json` |
| سطح المكتب | `desktop_*` | موافقات حساسة؛ dry-run؛ مفتاح إيقاف (المرحلة 6) |

## الخلفية حسب النظام

| المنصة | الخلفية | الواقع |
| --- | --- | --- |
| Windows | `windows-uia` | UIA / إدخال / حافظة / لقطات |
| Linux | `linux-x11-wayland` | wmctrl/xdotool أو ydotool · لقطات grim/scrot/gnome-screenshot · AT-SPI اختياري عبر python3-pyatspi |
| macOS | `macos-accessibility` | osascript + screencapture (قد تحتاج إذن Accessibility) |
| اختبارات | `SAM_DESKTOP_BACKEND=mock` | أي نظام |

غياب الأدوات → أخطاء واضحة مع تلميح التثبيت (`pnpm run doctor` / `GET /api/desktop/backend`).

### حزم Ubuntu

```bash
sudo apt install wmctrl xdotool scrot gnome-screenshot xclip python3-pyatspi
# Wayland اختياري:
sudo apt install grim wl-clipboard ydotool
```

## سياسة `run_shell` (متعدد المنصات)

| النظام | الصدفة | أمثلة مسموحة |
| --- | --- | --- |
| Windows | `cmd` / PowerShell | `dir`, `type`, `echo`, `where`, `Get-*` |
| Linux/macOS | `bash -lc` | `ls`, `cat`, `echo`, `pwd`, `find`, … — **بدون أنابيب/إعادة توجيه** |

## صندوق الملفات والبريد والمجدول

كما في المراحل السابقة: جذور مسموحة، بريد SMTP/Resend بموافقة، Daily Ops داخل Control Plane.

أعلام الأمان: `APPROVE_DESKTOP`, `SAM_DESKTOP_DRY_RUN`, `SAM_DESKTOP_PAUSED`, `SAM_DESKTOP_KILLED`. التطبيقات الحساسة ما زالت تحتاج موافقات المرحلة 6.
