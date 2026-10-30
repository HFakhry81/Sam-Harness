# الأمان والموافقات والتدقيق

المصدر: `src/lib/trust/*`, Phase 6، `.env.example`.

## المبادئ المنفّذة

- لا نجاح صامت: بوابات قبول لكل خطوة حساسة (`SAM_TRUST_GATES=1` افتراضي)  
- موافقة بشرية (HITL) لـ: حذف/تدمير ملفات خارج المخرجات، بريد صادر، إنفاق سحابي فوق العتبة، تطبيقات سطح مكتب حسّاسة  
- سجل تدقيق متسلسل بالتجزئة في SQLite + `pnpm run trust:verify`  
- حزم أدلة تحت `SAM_OUTPUT_HOME`  

## أوامر الثقة

```bash
pnpm run trust:verify
pnpm run trust:approvals
pnpm run trust:approve
pnpm run trust:deny
pnpm run trust:evidence
pnpm run trust:policy
```

## أعلام الموافقة (CI / بيئة موثوقة فقط)

`APPROVE_TRUST`, `APPROVE_DESTRUCTIVE`, `APPROVE_SPEND`, `APPROVE_COMMS`, `APPROVE_DESKTOP`  
لا تضبطها في صدفات غير موثوقة.

## لوحة التحكم

`/api/trust/policy`, `/api/trust/approvals`, `/api/trust/audit`, `/api/trust/evidence/…`, `/api/trust/gates/…`  
مصادقة المالك إلزامية لمعظم `/api/*`. الاستضافة على `127.0.0.1` مع فحص Origin/Host.

## صندوق الملفات والتوكن

المسارات الحساسة مرفوضة دائماً. لا ترفع `.env` أو `.controlplane-token` أو `mcp.json` إن حوى أسراراً إلى git.
