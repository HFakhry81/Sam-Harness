# نظام التفويض والتعاون بين الوكلاء — Sam-Harness

**المنصة:** Sam-Harness — وكالة ذكاء اصطناعي هجينة  
**اللغة:** العربية  
**الهدف:** استبدال خط السير العمل الثابت بنظام تفويض حيث يتفاوض الوكلاء فيما بينهم قبل اتخاذ القرار.

---

## 1. المشكلة

النظام الحالي يعتمد على خط سير عمل ثابت (Fixed Pipeline):
```
Intake → Evidence → Strategist → Auditor → Architect → Help → Marketer
```

هذه السلسة لا تسمح للوكلاء بالمناقشة أو الاعتراض أو تعديل الخطة بشكل ديناميكي بناءً على ملاحظات الوكلاء الآخرين.

---

## 2. الحل المقترح: نظام التفويض (Delegation System)

### 2.1 مفهوم النظام

بدلاً من خط سير ثابت، كل مهمة تمر عبر مراحل تفويض:
1. **العرض (Proposal):** وكيل يقترح خطة أو قرار.
2. **المراجعة (Review):** وكلاء آخرون يراجعون المقترح ويقدمون ملاحظاتهم.
3. **التفاوض (Negotiation):** الوكلاء يتفاوضون على التعديلات حتى الوصول لتوافق.
4. **التفويض (Delegation):** يتم تفويض التنفيذ للوكلاء المعنيين.
5. **التنفيذ والتحقق (Execute & Verify):** التنفيذ مع التحقق بعد الفعل.

### 2.2 آلية التصويت والتوافق

| النوع | الوصف | النصاب المطلوب |
|-------|--------|--------------|
| توافق إجماعي (Consensus) | جميع الوكلاء المعنيون يوافقون | 100% |
| أغلبية مطلقة (Majority) | أكثر من نصف الوكلاء يوافقون | >50% |
| فيتو (Veto) | وكيل واحد يمكنه رفض القرار لأسباب أمنية | 1 وكيل |
| تفويض المدير (CEO Delegation) | CEO router يقرر نهائياً | CEO فقط |

### 2.3 دورة حياة التفويض

```
[ proposer ] → propose → [ reviewers ] → review → [ negotiators ] → negotiate → [ delegator ] → delegate → [ executors ] → execute → [ verifier ] → verify → done
```

كل مرحلة لها مهلة زمنية (timeout)، وفي حال انتهاء المهلة بدون قرار، ينتقل القرار إلى CEO router للتحديد. كل جولة تفاوض تُوثق مع اسمها ونتيجتها.

---

## 3. الهيكل التقني

### 3.1 مكونات النظام

```
src/delegation/
├── proposal.ts       # إنشاء وعرض المقترحات
├── review.ts         # مراجعة المقترحات من قبل الوكلاء
├── negotiate.ts      # التفاوض بين الوكلاء
├── delegate.ts       # تفويض التنفيذ
├── vote.ts           # نظام التصويت والتوافق
├── protocol.ts       # بروتوكول التواصل بين الوكلاء
└── state.ts          # حالة التفويض (pending, approved, rejected, delegated, executed)
```

### 3.2 بروتوكول التواصل بين الوكلاء

جميع الاتصالات بين الوكلاء تمر عبر رسائل منظمة:

```typescript
interface DelegationMessage {
  id: string;
  from: string;        // معرف الوكيل المرسل
  to: string[];        // معرف الوكلاء المستقبلين
  type: "proposal" | "review" | "negotiation" | "delegation" | "vote" | "objection";
  content: any;
  timestamp: number;
  deadline: number;    // مهلة الاستجابة
  requiresResponse: boolean;
  parentId?: string;   # رسائل مرتبطة
}
```

### 3.3 حالات التفويض (State Machine)

| الحالة | الوصف | الانتقال التالي |
|--------|--------|----------------|
| `pending` | المقترح قيد الانتظار للمراجعة | under_review |
| `under_review` | الوكلاء يراجعون المقترح | negotiated / rejected |
| `negotiated` | تم التفاوض على التعديلات | approved / rejected |
| `approved` | المقترح aprobado | delegated |
| `delegated` | تم تفويض التنفيذ | executing |
| `executing` | التنفيذ جاري | verified / failed |
| `verified` | تم التحقق من التنفيذ | done |
| `rejected` | تم الرفض | archived |
| `failed` | فشل التنفيذ | retried / archived |
| `done` | المكتمل بنجاح | archived |

---

## 4. مثال على سير العمل الجديد

### المهمة: تعديل إعدادات النظام

**الخطوة 1 — العرض (Proposal):**
```
Architect → proposing → CEO, Auditor, Strategist
المحتوى: "اقترح تعديل إعدادات الذاكرة للساندبوكس من 512MB إلى 1GB"
المهلة: 30 دقيقة
```

**الخطوة 2 — المراجعة (Review):**
```
Auditor → reviewing → Architect
الملاحظة: "زيادة الذاكرة قد تؤدي لاستهلاك موارد عالي. يرجى إضافة حد أقصى مراقبة."
Strategist → reviewing → Architect
الملاحظة: "الموافقة بشرط عدم تجاوز سقف التكلفة اليومي."
```

**الخطوة 3 — التفاوض (Negotiation):**
```
Architect → negotiating → Auditor, Strategist
التعديل المقترح: "تحديد الذاكرة بـ 756MB مع مراقبة استهلاك الموارد"
```

**الخطوة 4 — التصويت (Vote):**
```
CEO: موافق
Auditor: موافق (مع شرط المراقبة)
Strategist: موافق
النتيجة: توافق إجماعي → delegated
```

**الخطوة 5 — التفويض والتنفيذ (Delegate & Execute):```
CEO → delegating → Operator
Operator → executing → sandbox.ts
Operator → verifying → بعد التنفيذ
النتيجة: done
```

---

## 5. واجهة برمجة التطبيقات (API)

```typescript
// إنشاء مقترح جديد
POST /api/delegation/propose
Body: { from, to, type, content, deadline }

// مراجعة مقترح
POST /api/delegation/review
Body: { proposalId, reviewerId, decision: "approve" | "reject" | "modify", comments }

// تفاوض
POST /api/delegation/negotiate
Body: { proposalId, negotiatorId, modifiedContent }

// تفويض تنفيذ
POST /api/delegation/delegate
Body: { proposalId, delegatorId, executorId }

// التصويت
POST /api/delegation/vote
Body: { proposalId, voterId, decision: "yes" | "no" | "veto" }

// الحصول على حالة التفويض
GET /api/delegation/status/:proposalId
```

---

## 6. التكامل مع النظام الحالي

| المكون الحالي | التكامل مع نظام التفويض |
|--------------|------------------------|
| LangGraph review loop | يصبح مرحلة مراجعة داخل نظام التفويض |
| GO/No-Go gate | يصبح مرحلة تصويت مع فيتو للـ CEO |
| Zust files | يتم تخزين حالات التفويض في SQLite |
| Control Plane UI | واجهة لعرض案ات التفويض والتصويت عليها |

---

## 7. المزايا المتوقعة

1. **قرارات أفضل:** multiple وجهات نظر قبل التنفيذ.
2. **أمان أعلى:** فيتو للوكلاء الأمنيين (Auditor).
3. **مرونة أكبر:** تعديل الخطط بشكل ديناميكي.
4. **تتبع أوضح:** كل قرار مسجل مع من اتخذه ولماذا.
5. **تقليل الأخطاء:** اكتشاف المشاكل قبل التنفيذ وليس بعده.

---

## 8. خطة التنفيذ المرحلية

| المرحلة | العنصر | المدة | الاعتمادات |
|---------|--------|-------|------------|
| 1 | إنشاء ملفات المقترحات والمراجعة | أسبوع | auth.ts، src/lib/db/ |
| 2 | نظام التصويت والتوافق | أسبوع | المرحلة 1 |
| 3 | آلية التفويض والتنفيذ | أسبوع | المرحلة 2 |
| 4 | واجهة المستخدم للتفويض | أسبوعان | المرحلة 3، Control Plane |
| 5 | التكامل مع LangGraph و GO Gate | أسبوع | المرحلة 4 |
| 6 | الاختبار والتوثيق | أسبوع | جميع المراحل |
