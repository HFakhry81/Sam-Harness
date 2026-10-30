# استكشاف الأخطاء — doctor

```bash
pnpm run doctor
```

يفحص محلياً (بدون شبكة إلزامية): المنصة، Node≥20، حقل pnpm، وجود `.env`، `node_modules`، `task.ts`، `SAM_OUTPUT_HOME`، تغطية i18n، وملاحظة عن Ollama (لا يُفحص الاتصال افتراضياً).

## أعطال شائعة

| العرض | ماذا تفعل |
| --- | --- |
| الواجهة تطلب توكن | افتح `.controlplane-token` أو عيّن `CONTROL_PLANE_TOKEN` |
| المتخصصون على محلي رغم المفتاح | تحقق من السقف، `HYBRID_MODE=local`، `FORCE_LOCAL_SPECIALISTS`، أو قرب السقف |
| Level-3 مرفوض | ضع GO عبر `--go` / `IMPLEMENT_GO` / `go-nogo.json` |
| سطح المكتب لا يعمل على أوبونتو | متوقع — stub؛ استخدم ويندوز أو أدوات الملفات فقط |
| `pnpm test` يفشل على المسارات | شغّل من جذر المستودع بعد `pnpm install` |
| Ollama errors | ثبّت Ollama واسحب النماذج (`Tools\06-pull-ollama-models.bat` أو `ollama pull`) |

صحة الخدمة: `GET /healthz` أثناء عمل Control Plane.
