# التثبيت

## بنقرة واحدة (موصى به)

**Windows**

```bat
scripts\install\install.cmd
:: أو: powershell -ExecutionPolicy Bypass -File scripts\install\install.ps1
```

**macOS / Linux (Ubuntu)**

```bash
bash scripts/install/install.sh
```

يثبّت/يتحقق من Node وpnpm، يشغّل `pnpm install`، ينشئ `.env` من المثال (يسأل عن اللغة)، يجهّز `~/Documents/Sam-Harness`، اختيارياً يسجّل بدء التشغيل، ثم `pnpm run doctor`.

إلغاء: `uninstall.ps1` / `uninstall.sh`.

غير تفاعلي: `pnpm run install:unix` أو `pnpm run install:win`.

## يدوي (Windows Tools)

1. `Tools\01-setup-prereqs.bat`  
2. `Tools\02-install-deps.bat`  
3. `Tools\06-pull-ollama-models.bat` (مرة)  
4. `SamHarness.bat` أو `Tools\05-start-ui.bat`  

الواجهة: http://127.0.0.1:8787/ — يلزم توكن المالك (`.controlplane-token` أو `CONTROL_PLANE_TOKEN`).

## متطلبات

- Node ≥ 20، pnpm ≥ 9 (الحزمة تثبّت عبر `packageManager` pnpm@11)  
- Ollama محلي للنماذج المحلية (اختياري لكن موصى)  
- مفتاح `OLLAMA_API_KEY` للسحابة ضمن السقف  

بعد التثبيت: `pnpm run doctor` ثم `pnpm run ui`.
