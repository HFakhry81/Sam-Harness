# الاختيار والتوصيل حسب نظام التشغيل

## كيف يُختار النموذج

1. `FORCE_LOCAL_SPECIALISTS=1` → محلي دائماً  
2. وإلا `HYBRID_MODE` من البيئة  
3. وإلا ملف الهجين  
4. الافتراضي: `auto`  
5. ثم `resolveModelRoute` باستخدام:
   - **سقف التكلفة / قرب السقف (يفوز دائماً)**
   - خريطة الهجين لكل دور
   - الصعوبة + `prefersCloud` من إعداد الفريق
   - المفتاح والميزانية المتبقية
   - نماذج الدور من `config/team.json` / `SAM_ROLE_*`

لقطة حية: `GET /api/routing/effective` أو فحص doctor **Per-role routing**.

## المزودات وعناوين الأساس

| الطبقة | Base URL | المفتاح | التكلفة |
| --- | --- | --- | --- |
| محلي | `SAM_LOCAL_BASE_URL` | لا | ٠ |
| مجاني | `SAM_FREE_BASE_URL` | `SAM_FREE_API_KEY` | ٠ عند الضبط |
| مدفوع | `SAM_PAID_BASE_URL` | `OLLAMA_API_KEY` | من السقف اليومي |

## الفروقات حسب النظام

| المكوّن | Ubuntu/Linux | Windows | macOS |
| --- | --- | --- | --- |
| مشغّل سطح المكتب | xdotool/wmctrl/ydotool + لقطات | PowerShell/UIA | osascript + screencapture |
| `screenshot` | نعم إن وُجدت الأدوات | نعم | نعم |
| `run_shell` | قائمة bash | PowerShell/`Get-*` | قائمة bash |
| التثبيت | `install.sh` | `install.ps1` | `install.sh` |

نفس الأدوار في كل مكان؛ **خلفيات الأدوات** تختلف.
