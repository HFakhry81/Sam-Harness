# استكشاف الأخطاء — doctor

```bash
pnpm run doctor
```

أو من مدير الأدوات:

```bat
Tools\Sam-Harness-Manager.cmd -Action doctor
```

```bash
bash Tools/sam-harness-manager.sh --action doctor
```

يفحص محلياً (بدون شبكة إلزامية): المنصة، Node≥20، حقل pnpm، وجود `.env`، `node_modules`، `task.ts`، `SAM_OUTPUT_HOME`، تغطية i18n، إعداد الفريق/التوجيه لكل دور، وملاحظة عن Ollama (لا يُفحص الاتصال افتراضياً).

فحص حي (doctor + `/healthz` إن كانت الواجهة تعمل):

```bash
bash Tools/sam-harness-manager.sh --action health
```

## أعطال شائعة

| العرض | ماذا تفعل |
| --- | --- |
| الواجهة تطلب توكن | افتح `.controlplane-token` أو عيّن `CONTROL_PLANE_TOKEN` |
| المتخصصون على محلي رغم المفتاح | تحقق من السقف، `HYBRID_MODE=local`، `FORCE_LOCAL_SPECIALISTS`، أو قرب السقف |
| Level-3 مرفوض | ضع GO عبر `--go` / `IMPLEMENT_GO` / `go-nogo.json` |
| سطح المكتب لا يعمل على أوبونتو | متوقع — stub؛ استخدم ويندوز أو أدوات الملفات فقط |
| `pnpm test` يفشل على المسارات | شغّل من جذر المستودع بعد `pnpm install` |
| Ollama errors | ثبّت Ollama واسحب النماذج (مدير الأدوات → `pull-models` أو `06-pull-ollama-models.*` — من `config/team.json`) |
| التحديث مرفوض | شجرة العمل غير نظيفة — احفظ/التزم ثم `update` |
| مشاكل DB / ترحيل | `pnpm run migrate` أو إجراء `repair` |
| تحتاج لقطة | `backup` / `restore` (قاعدة البيانات + config + `.env`) |

سجلات المدير: `SAM_OUTPUT_HOME/logs/manager-*.log` (احتياطي `Tools/logs/`). العرض عبر **view-logs**.

صحة الخدمة: `GET /healthz` أثناء عمل Control Plane.
