# آلية تسجيل التقدم — Sam-Harness

**المنصة:** Sam-Harness — وكالة ذكاء اصطناعي هجينة  
**اللغة:** العربية  
**الهدف:** آلية ذكية لتسجيل مراحل التقدم (تم - قيد التنفيذ - لم ينفذ) لتسهيل التطوير على مراحل.

---

## 1. حالات التقدم

| الحالة | الرمز | المعنى | الإجراء المطلوب |
|--------|-------|--------|---------------|
| تم | ✅ | المهمة مكتملة وجاهزة للمراجعة | الانتقال للمهمة التالية |
| قيد التنفيذ | 🔄 | المهمة جارية العمل عليها | المتابعة حتى الإتمام |
| لم ينفذ | ❌ | المهمة لم تبدأ بعد | الجدولة والبدء |
| معطل | ⚠️ | المهمة متوقفة لاعتماد على مهمة أخرى | حل الاعتماد ثم الاستئناف |
| ملغي | ❌❌ | المهمة ملغاة وغير مطلوبة | التوثيق والإلغاء الرسمي |

---

## 2. ملف حالة التقدم (JSON)

يُحفظ ملف حالة التقدم في المسار التالي:
```
SAM_OUTPUT_HOME/progress/progress-state.json
```

### هيكل الملف:

```json
{
  "version": "1.0",
  "lastUpdated": "2026-11-05T10:00:00Z",
  "phases": {
    "P0": { "status": "done", "progress": 100, "notes": "مكتمل" },
    "P1": { "status": "done", "progress": 100, "notes": "مكتمل" },
    "P2": { "status": "in_progress", "progress": 90, "notes": "بقي Evals + رفض الهلوسة" },
    "P3": { "status": "done", "progress": 100, "notes": "مكتمل" },
    "P4": { "status": "in_progress", "progress": 80, "notes": "بقي دعم darwin/linux" },
    "P5": { "status": "done", "progress": 90, "notes": "بقي تحسين التوجيه الهجين" },
    "P6": { "status": "done", "progress": 100, "notes": "مكتمل" },
    "P7": { "status": "done", "progress": 100, "notes": "مكتمل" },
    "P8": { "status": "in_progress", "progress": 70, "notes": "بقي Linux/macOS desktop" },
    "P9": { "status": "in_progress", "progress": 60, "notes": "بقي إكمال المحرر المرئي" },
    "P10": { "status": "in_progress", "progress": 75, "notes": "تم إصلاح: تشفير التوكن، sandbox command injection، rate limiting، session rotation، XSS/CSP. بقي: MFA، RBAC، تشفير SQLite، DLP، WAF" },
    "P11": { "status": "not_started", "progress": 0, "notes": "نظام التعاون多人" },
    "P12": { "status": "not_started", "progress": 0, "notes": "التكاملات الخارجية" },
    "P13": { "status": "not_started", "progress": 0, "notes": "الأمان المتقدم" },
    "P14": { "status": "not_started", "progress": 0, "notes": "الاختبار التلقائي" },
    "P15": { "status": "not_started", "progress": 0, "notes": "المحرر المرئي V2" }
  },
  "tasks": {
    "T1": { "id": "T1", "phase": "P10", "title": "تشفير توكن لوحة التحكم", "status": "done", "progress": 100, "notes": "تم إضافة encryptToken و decryptToken بـ AES-256-CBC مع مفتاح من CONTROL_PLANE_ENCRYPTION_KEY", "priority": "high" },
    "T2": { "id": "T2", "phase": "P10", "title": "إصلاح sandbox.ts command injection", "status": "done", "progress": 100, "notes": "تم إضافة validateCode و validateNodeArgs وقائمة الأوامر المسموح بها ALLOWED_NODE_COMMANDS", "priority": "high" },
    "T4": { "id": "T4", "phase": "P10", "title": "تحديد المعدل Rate Limiting", "status": "done", "progress": 100, "notes": "تم إضافة checkRateLimit في server.ts مع حدود 120 طلب/دقيقة لكل IP", "priority": "high" },
    "T5": { "id": "T5", "phase": "P10", "title": "تدوير الجلسات تلقائياً Session Rotation", "status": "done", "progress": 100, "notes": "تم إضافة SESSION_ROTATE_AFTER_MS و MAX_SESSIONS مع تدوير تلقائي كل 4 ساعات", "priority": "medium" },
    "T6": { "id": "T6", "phase": "P10", "title": "إصلاح XSS في واجهة التحكم Content Security Policy", "status": "done", "progress": 100, "notes": "تم إضافة رؤوس CSP و X-Content-Type-Options و X-Frame-Options و Referrer-Policy لـ serveStatic", "priority": "high" },
    "T3": { "id": "T3", "phase": "P11", "title": "نظام التعاون多人", "status": "not_started", "priority": "high" }
  }
}
```

---

## 3. أوامر تحديث التقدم

### تحديث مرحلة معينة:
```bash
node scripts/update-progress.js --phase P10 --status done --progress 100 --notes "مكتمل"
```

### تحديث مهمة معينة:
```bash
node scripts/update-progress.js --task T1 --status in_progress --progress 30 --notes "جاري التشفير"
```

### عرض حالة التقدم:
```bash
node scripts/update-progress.js --status
```

### إخراج تقرير التقدم:
```bash
node scripts/update-progress.js --report
```

---

## 4. سكريبت تحديث التقدم (نموذج)

```javascript
// scripts/update-progress.js
const fs = require("fs");
const path = require("path");

const PROGRESS_FILE = path.join(process.env.SAM_OUTPUT_HOME || process.env.HOME + "/Documents/Sam-Harness", "progress", "progress-state.json");

function readProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return { version: "1.0", phases: {}, tasks: {}, lastUpdated: new Date().toISOString() };
  return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
}

function writeProgress(data) {
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
}

function updatePhase(phaseId, status, progress, notes) {
  const data = readProgress();
  if (!data.phases[phaseId]) data.phases[phaseId] = {};
  data.phases[phaseId] = { status, progress: Number(progress), notes };
  writeProgress(data);
  console.log(`✅ تم تحديث المرحلة ${phaseId}: ${status} (${progress}%)`);
}

function updateTask(taskId, status, progress, notes, priority) {
  const data = readProgress();
  if (!data.tasks[taskId]) data.tasks[taskId] = {};
  data.tasks[taskId] = { id: taskId, status, progress: Number(progress), notes, priority };
  writeProgress(data);
  console.log(`✅ تم تحديث المهمة ${taskId}: ${status} (${progress}%)`);
}

function showStatus() {
  const data = readProgress();
  console.log("=== حالة تقدم Sam-Harness ===\n");
  for (const [phase, info] of Object.entries(data.phases)) {
    const icon = info.status === "done" ? "✅" : info.status === "in_progress" ? "🔄" : "❌";
    console.log(`${icon} ${phase}: ${info.status} - ${info.progress}% - ${info.notes || ""}`);
  }
}

const args = process.argv.slice(2);
if (args.includes("--status")) {
  showStatus();
} else if (args.includes("--phase")) {
  const phaseIdx = args.indexOf("--phase");
  updatePhase(args[phaseIdx + 1], args[args.indexOf("--status") + 1], args[args.indexOf("--progress") + 1], args[args.indexOf("--notes") + 1]);
} else if (args.includes("--task")) {
  const taskIdx = args.indexOf("--task");
  updateTask(args[taskIdx + 1], args[args.indexOf("--status") + 1], args[args.indexOf("--progress") + 1], args[args.indexOf("--notes") + 1], args[args.indexOf("--priority") + 1]);
}
```

---

## 5. لوحة التقدم المرئية (لوحة التحكم)

يمكن عرض التقدم في Control Plane عبر نقطة نهاية:
```
GET /api/progress/status
```

الاستجابة:
```json
{
  "overallProgress": 65,
  "phasesDone": 7,
  "phasesTotal": 15,
  "tasksDone": 12,
  "tasksTotal": 45,
  "blockedTasks": 2,
  "nextMilestone": "M1 - نهاية Q1 2027"
}
```

---

## 6. عملية الدفع بعد كل مرحلة

بعد إتمام كل مرحلة:

1. تحديث `progress-state.json` بحالة المرحلة (تم/قيد التنفيذ/لم ينفذ).
2. commit التغييرات في الفرع المحلي:
   ```bash
   git add .
   git commit -m "feat: 완료 المرحلة PX - [وصف المرحلة]"
   ```
3. الدفع للريموت:
   ```bash
   git push origin <branch-name>
   ```
4. فتح PR ضد staging للمراجعة.

---

## 7. لوحة الملخص الشهرية

| الشهر | المراحل المكتملة | المهام المنجزة | العقبات | الخطوة التالية |
|-------|----------------|---------------|---------|--------------|
| نوفمبر 2026 | P0-P7 | 30 مهمة | لا يوجد | P8-P10 |
| ديسمبر 2026 | P8-P10 | 25 مهمة |安全性 | P11-P13 |
| يناير 2027 | P11-P13 | 20 مهمة | التكامل | P14-P15 |
