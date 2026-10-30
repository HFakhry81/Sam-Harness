# التثبيت

## مدير الأدوات الموحّد (موصى به)

قائمة واحدة للتثبيت والتحديث وdoctor والنسخ الاحتياطي وسحب نماذج Ollama وغيرها:

**Windows**

```bat
Tools\Sam-Harness-Manager.cmd
:: غير تفاعلي:
Tools\Sam-Harness-Manager.cmd -Action install -NonInteractive
```

**macOS / Linux (Ubuntu)**

```bash
bash Tools/sam-harness-manager.sh
# غير تفاعلي:
bash Tools/sam-harness-manager.sh --action install --non-interactive
```

راجع `Tools/README.md` لقائمة الإجراءات (`install`, `setup-prereqs`, `update`, `build-check`, `pull-models`, `backup`, …).

## مثبت بنقرة واحدة (المرحلة 7)

إجراء `install` في المدير يُفوِّض إلى:

**Windows**

```bat
scripts\install\install.cmd
:: أو: powershell -ExecutionPolicy Bypass -File scripts\install\install.ps1
```

**macOS / Linux (Ubuntu)**

```bash
bash scripts/install/install.sh
```

يثبّت/يتحقق من Node وpnpm (Corepack حسب `packageManager`)، يشغّل `pnpm install`، ينشئ `.env` من المثال (يسأل عن اللغة)، يجهّز `~/Documents/Sam-Harness` (`SAM_OUTPUT_HOME`)، اختيارياً يسجّل بدء التشغيل، ثم `pnpm run doctor`.

إلغاء: إجراء `uninstall` أو `uninstall.ps1` / `uninstall.sh`.

غير تفاعلي: `pnpm run install:unix` أو `pnpm run install:win`.

## يدوي / غلافات Tools القديمة

السكربتات المرقّمة ما زالت تعمل وتستدعي المدير:

1. `Tools\01-setup-prereqs.bat` (أو `.sh`)  
2. `Tools\02-install-deps.bat`  
3. `Tools\06-pull-ollama-models.bat` (نماذج محلية من `config/team.json`)  
4. `SamHarness.bat` أو `Tools\05-start-ui.bat`  

الواجهة: http://127.0.0.1:8787/ — يلزم توكن المالك (`.controlplane-token` أو `CONTROL_PLANE_TOKEN`).

## مسار التحديث

```bash
bash Tools/sam-harness-manager.sh --action update
# يرفض شجرة git غير نظيفة → سحب الفرع الحالي (ff-only) → pnpm install → pnpm run migrate → doctor
```

## متطلبات

- Node ≥ 20، pnpm ≥ 9 (الحزمة تثبّت عبر `packageManager` pnpm@11.23.0)  
- Ollama محلي للنماذج المحلية (اختياري لكن موصى)  
- مفتاح `OLLAMA_API_KEY` للسحابة ضمن السقف  

بعد التثبيت: `pnpm run doctor` ثم `pnpm run ui`.
