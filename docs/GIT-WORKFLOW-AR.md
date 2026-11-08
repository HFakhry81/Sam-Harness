# دليل Git العملي — Sam-Harness (عربي مصري)

الدليل ده يشرح **بالتفصيل العملي** إزاي تشتغل بأمان على المستودع من غير ما الحماية أو الـ hooks تمنعك، وليه شاشة الـ PR بتظهر أحيانًا «فاشل» حتى لو الكود سليم.

**المسار الإنجليزي المختصر:** [`GIT_WORKFLOW.md`](./GIT_WORKFLOW.md) · **المساهمون:** [`CONTRIBUTING.md`](../CONTRIBUTING.md)

> **مسار المشروع على جهازك (Windows):** `E:\UpNexa.com\Sam-Harness`  
> كل أوامر الـ PowerShell في الدليل مفترض تتنفّذ من جوه المجلد ده إلا لو مكتوب غير كده.

---

## 1) الفكرة في جملة

الشغل اليومي **مش** بيتدفع على `main` ولا على `staging` مباشرة.

```
فرع ميزة (feat/* / fix/* / …)
    → Pull Request قاعدته staging
    → بعد ما CI ينجح: دمج في staging
    → بعدين فقط: PR إصدار staging → main
```

الحماية مش «عطلانة» — هي بترفض المسار الغلط. أشهر غلطة: فتح PR من `feat/...` **مباشرة على `main`**.

---

## 2) المصطلحات: حفظ ≠ Stage ≠ Commit ≠ Push ≠ PR ≠ Merge

| الخطوة | معناها | بيحصل فين؟ |
| --- | --- | --- |
| **Save (حفظ)** | حفظ الملف في الديسك داخل المحرر | محلي فقط — Git لسه مش شايفه كـ commit |
| **Stage** | اختيار الملفات اللي هتدخل في الـ commit (`git add`) | محلي — منطقة التجهيز |
| **Commit** | تسجيل لقطة محلية برسالة | محلي على فرعك |
| **Push** | رفع الـ commits للـ remote على GitHub | يحتاج صلاحية كتابة على **فرع الميزة** فقط |
| **Pull Request (PR)** | طلب مراجعة/دمج بين فرعين على GitHub | مش دمج تلقائي |
| **Merge** | دمج الـ PR فعليًا في الفرع الهدف | بعد المراجعات + فحوصات CI المطلوبة |

**مهم:** الحفظ في Cursor/VS Code **مش** بيعمل commit. والـ commit لوحده **مش** بيرفع لـ GitHub من غير push. والـ push لـ `main`/`staging` **مرفوض** بالحماية والـ hooks.

---

## 3) الممرات الثلاثة (Lanes)

| الفرع | الدور |
| --- | --- |
| `feat/*`, `fix/*`, `chore/*`, `docs/*`, `feature/*`, `hotfix/*`, `cursor/*`, … | شغل يومي. **يتفرّع من أحدث `staging`** |
| `staging` | دمج التكامل قبل الإنتاج |
| `main` | الإنتاج / الإصدار — يتحدث **فقط** عبر PR إصدار من `staging` |

**ملاحظة مهمة:** مش مطلوب إن `main` و `staging` يكون ليهم **نفس الـ SHA**. بعد دمج إصدار، `main` غالبًا فيه merge commit مختلف عن رأس `staging` حتى لو المحتوى متوافق. متخلّطش بين «متزامنين منطقيًا» و«نفس الهاش».

---

## 4) طبقات الحماية (ليه الدفع/الدمج بيتمنع)

1. **حماية فروع GitHub** على `main` و `staging`: ممنوع push مباشر؛ مطلوب PR؛ مطلوب فحوصات؛ مطلوب الفرع محدّث (strict up-to-date).
2. **فحص CI اسمه `branch-flow`:** يفشل لو قاعدة الـ PR غلط أو اسم الفرع/العنوان مخالف للقواعد (شوف القسم 12 و 14).
3. **Hooks محلية** في `.githooks/` (بتتفع مع `pnpm install` / `prepare`):
   - `pre-push`: يمنع الدفع لـ `main`/`staging` ويمنع أسماء فروع غير مسموحة.
   - `commit-msg`: يلزم Conventional Commits.
4. **المساعدات:** `git:new-branch` و `git:open-pr` دايمًا بتبدأ من / بتفتح على **`staging`**.

أسماء فحوصات مطلوبة معتادة:

| الاسم في GitHub | المعنى |
| --- | --- |
| `quality (ubuntu-latest)` | typecheck + اختبارات |
| `quality (windows-latest)` | نفس الشيء + PowerShell Tools |
| `quality (macos-latest)` | نفس المصفوفة |
| **`branch-flow`** | حراسة المسار/الاسم/العنوان |

**ممنوع:** `--no-verify`، force push على المحمي، تعطيل الحماية، أو حذف قواعد الـ checks عشان «تعدّي».

---

## 5) تجهيز الجهاز (مرة واحدة / عند اللزوم)

افتح **PowerShell 5.1** أو أحدث:

```powershell
cd E:\UpNexa.com\Sam-Harness
pnpm install
pnpm run git:setup-hooks
git config --get core.hooksPath
# المتوقع: .githooks
```

### متطلبات اختيارية لـ `gh` (فتح PR من الطرفية)

المساعد `git:open-pr` / `open-pr.ps1` يحتاج **GitHub CLI**:

```powershell
gh --version
gh auth status
```

- تثبيت: https://cli.github.com/
- Classic PAT: صلاحية `repo`
- Fine-grained: **Contents** + **Pull requests** (Read and write) على هذا المستودع
- لو الحساب غلط: `gh auth login`

من غير `gh` تقدر تعمل commit/push لفرع الميزة وتفتح الـ PR من واجهة GitHub — بس **قاعدة الـ PR لازم تفضل `staging`**.

---

## 6) بداية يوم آمنة (مسار موصى به)

### أ) شجرة نظيفة — فرع جديد من أحدث staging

```powershell
cd E:\UpNexa.com\Sam-Harness
git fetch origin
git status
```

لو الشجرة نظيفة:

```powershell
# الطريقة الموصى بها (تستدعي scripts\git\new-branch.ps1 منطقًا عبر pnpm/bash، أو استخدم الـ ps1 مباشرة)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\git\new-branch.ps1 -Name feat\my-change
```

أو عبر pnpm (يحتاج Bash المتوفر مع Git for Windows لأن سكربت الحزمة هو `.sh`):

```powershell
pnpm run git:new-branch -- feat/my-change
```

**السلوك المتحقّق من المصدر:** المساعد يعمل `git fetch origin staging` ثم `git checkout -B <name> origin/staging`. يرفض لو الشجرة وسخة أو اسم الفرع غير مسموح.

أسماء مسموحة (أمثلة): `feat/...`, `fix/...`, `chore/...`, `docs/...`, `feature/...`, `hotfix/...`, `cursor/...`.

بعد التعديل:

```powershell
git add -A
git status
git commit -m "feat: وصف قصير بالإنجليزي للرسالة"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\git\open-pr.ps1 -Title "feat: وصف قصير"
```

**سلوك `open-pr.ps1` المتحقّق:** يدفع الفرع الحالي ثم ينفّذ `gh pr create --base staging --head <branch>`. يرفض الفتح من `main` أو `staging`.

### ب) أنت واقف على `main` أو `staging` وفي تعديلات محلية (وسخ)

**متعملش** `git reset --hard` ولا `git clean -fd` إلا لو أنت متأكد إنك عايز تمسح الشغل.

احفظ الشغل بأمان:

```powershell
cd E:\UpNexa.com\Sam-Harness
git status
git stash push -u -m "wip before leaving protected branch"
git fetch origin staging
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\git\new-branch.ps1 -Name feat\my-change
git stash pop
# حل أي تعارض إن ظهر، ثم add + commit كالمعتاد
```

بديل من غير stash: انسخ الملفات لمكان مؤقت خارج Git، رجّع الفرع نظيف، افتح فرع ميزة، رجّع الملفات.

### ج) فرع موجود أصلًا زي `feat/ui-fix` — متضيعش الشغل

لو الفرع موجود على GitHub ومتفعل محليًا:

```powershell
cd E:\UpNexa.com\Sam-Harness
git fetch origin
git checkout feat/ui-fix
git status
```

حدّثه من staging بـ **merge** (مش rebase / مش force) — شوف القسم 9.

---

## 7) أوامر PowerShell المكافئة (بدون المساعد)

نفس القواعد، يدويًا:

```powershell
cd E:\UpNexa.com\Sam-Harness
git fetch origin staging
git checkout -B feat/my-change origin/staging
# ... عدّل ...
git add -A
git commit -m "feat: my change"
git push -u origin feat/my-change
```

فتح PR (مع `gh`):

```powershell
gh pr create --base staging --head feat/my-change --title "feat: my change" --body "## Summary`n- ..."
```

أو من موقع GitHub: New Pull Request → **base = `staging`** ← compare = فرع الميزتك.

---

## 8) قراءة شاشة الـ PR (زي اللي ظهرت عندك)

الأعمدة المعتادة:

| اللي بتشوفه | المعنى |
| --- | --- |
| **Checks / branch-flow = fail** | مسار/قاعدة/عنوان الـ PR مخالف للقواعد — غالبًا مش معناه إن الكود معطوب |
| **quality (*) = pass/green** | الاختبارات عدّت |
| **Out-of-date / Behind** | رأس فرعك مش محدّث بالنسبة لفرع القاعدة (الـ base) حسب حماية «Require branches to be up to date» |
| **Merge blocked** | واحد أو أكتر من المطلوب فاشل أو الفرع متأخر أو في تعارض |

فرّق كمان:

- **Failure (فشل):** الفحص خلص ورفض.
- **Pending / Queued / In progress:** لسه بيشتغل — استنى؛ متعتبرهوش فشل.

---

## 9) تحديث فرع متأخر: ادمج `origin/staging` (مش rebase)

السياسة العملية هنا: **merge** من staging داخل فرع الميزتك، **من غير** rebase ومن غير force push.

```powershell
cd E:\UpNexa.com\Sam-Harness
git checkout feat/ui-fix
git fetch origin staging
git merge origin/staging
```

لو ظهرت تعارضات:

1. افتح الملفات المتعارضة وحلّها.
2. `git add` للملفات المحلولة.
3. كمّل الـ merge commit (`git commit` لو Git طلب).
4. `git push` لفرع الميزتك (push عادي، مش `--force`).

### إلغاء الـ merge بأمان لو حاسس إنك تخبطت

**قبل** ما تكمّل الـ merge commit:

```powershell
git merge --abort
```

ده يرجعك لحالة ما قبل محاولة الدمج (طالما الـ merge لسه مش مكتمل).

**متستخدمش** على المحمي: `git push --force`, `git reset --hard origin/...` عشوائي، أو تعطيل الـ hooks.

---

## 10) إصلاح PR مفتوح على قاعدة غلط (تعليمات فقط — مثال PR #48)

### اللي اتأكد من GitHub مباشرة (موثّق)

على **PR #48** (`https://github.com/HFakhry81/Sam-Harness/pull/48`) وقت الفحص:

| العنصر | القيمة المتحققة |
| --- | --- |
| العنوان | `fix: UI Fix` (صيغة Conventional Commits مقبولة) |
| الرأس (head) | `feat/ui-fix` @ `0f52adad824ce51583de44405b4feed6cab0ce85` |
| القاعدة (base) | **`main`** ← هنا المشكلة |
| `branch-flow` | **FAILURE** — الرسالة الرسمية من CI: *PRs into main must come from staging (got head='feat/ui-fix')* |
| `quality` (ubuntu / windows / macos) | **SUCCESS** |
| حالة الدمج | `BEHIND` / out-of-date بالنسبة لقاعدة `main` |

ده يطابق شاشة فيها quality أخضر + branch-flow أحمر + out-of-date. **الحماية شغّالة صح**؛ المسار هو الغلط.

> ملاحظة تاريخية: فشل `branch-flow` اتسجّل في تشغيلات حوالي **2026-11-08** (توقيت GitHub). لو التاريخ على جهازك مختلف، اعتمد على صفحة الـ Checks في الـ PR.

### المطلوب منك (من غير ما الوكيل يغيّر PR #48)

1. **غيّر قاعدة الـ PR إلى `staging`** من واجهة GitHub:  
   PR → Edit (جنب base/compare) → Base = `staging` → حفظ.  
   أو بالطرفية (لو `gh` متاح وأنت مصرّح لنفسك):

   ```powershell
   gh pr edit 48 --base staging
   ```

2. استنى إعادة تشغيل الفحوصات. المفروض `branch-flow` يعدّي **لو** القاعدة بقت `staging` واسم الفرع مسموح والعنوان conventional (متحقق: العنوان والفرع أصلًا مناسبين).

3. لو ظهر بعد كده **Out-of-date مقابل staging**: نفّذ القسم 9 (`git merge origin/staging` ثم push) على `feat/ui-fix`.

4. **متدمجش في `main` من الفرع ده.** بعد ما PR الميزات يتدمج في `staging` وCI أخضر، الإصدار بيتم لاحقًا بـ PR منفصل: `staging` → `main`.

5. بديل لو حابب تبدأ PR نظيف: اقفل #48 من الواجهة (من غير حذف الفرع)، وحدّث الفرع، وافتح PR جديد بقاعدة `staging` عبر المساعد أو `gh pr create --base staging`.

---

## 11) مسار الإصدار (Release) فقط

بعد ما ميزاتك اتنقلت لـ `staging` والفحوصات خضراء:

1. افتح PR: **head = `staging`**, **base = `main`**.
2. استنى `quality (*)` و **`branch-flow`** يخضروا على رأس `staging` الحالي.
3. ادمج الإصدار.
4. متفتكرش إن تساوي SHA بين `main` و `staging` شرط نجاح — المهم محتوى الإصدار والفحوصات على رأس الـ PR.

---

## 12) جدول أعطال شائعة وحلولها

| العرض | السبب الشائع | الحل |
| --- | --- | --- |
| Push مرفوض على `main`/`staging` | حماية + `pre-push` | اشتغل على فرع ميزة وادفعه، وافتح PR لـ staging |
| `branch-flow` فشل: *must come from staging* | PR للـ main من `feat/...` | غيّر base إلى `staging` (شوف §10) |
| `branch-flow` فشل: اسم فرع | بادئة غير مسموحة | فرع جديد باسم مسموح من staging |
| `commit-msg` رفض الرسالة | مش Conventional Commits | مثلًا: `fix: UI Fix` / `feat: add X` |
| Out-of-date | الفرع متأخر عن الـ base | `git merge origin/staging` ثم push |
| `gh` / صلاحيات كتابة | توكن أو حساب غلط | `gh auth status` ثم login بالصلاحيات الصحيحة |
| المساعد رفض «dirty tree» | في تعديلات غير متسجّلة | commit أو stash قبل `new-branch` |

---

## 13) تنظيف الفروع ومزامنة main/staging

### مزامنة محلية للقراءة فقط

```powershell
cd E:\UpNexa.com\Sam-Harness
git fetch origin
git checkout main
git pull origin main
git checkout staging
git pull origin staging
```

ده **تحديث لمتابعتك المحلية** — مش معناه إن الهاشين لازم يبقوا متساويين.

### حذف فرع ميزة بعد الدمج

احذف **بعد** ما تتأكد إن الـ PR اتنقل وCI كان أخضر، ومن غير ما تمسح شغل غير مدموج:

```powershell
# بعد الدمج في staging والتأكد
git push origin --delete feat/old-done   # فرع remote منتهي فقط
git branch -d feat/old-done             # محلي، لو الدمج معروف لـ Git
```

**تحذير:** متتحذفش فرع لسه عليه commits مش موجودة في `staging`/`main`. لو مش متأكد:

```powershell
git fetch origin
git log --oneline origin/staging..feat/maybe-important
```

لو طلعت commits، متتحذفش قبل ما تتأكد إنها اتنقلت أو مش محتاجها.

`main` و `staging` **متتحذفوش** ومتتعملهمش force push.

---

## 14) مرجع سريع: قواعد `branch-flow` من المصدر

من `scripts/git/check-pr-flow.sh` و `lib-branch-flow.sh` و`.github/workflows/branch-flow.yml`:

- لو **base = main** → لازم **head = staging** فقط (إصدار).
- لو **base = staging** → لازم head يكون فرع ميزة بالبادئات المسموحة، ومش `main`/`staging`.
- عنوان الـ PR: Conventional Commits (`feat:`, `fix:`, `chore:`, …). إصدارات `main` كمان تقبل عناوين تبدأ بـ `Release`.
- الـ workflow بيتشغّل على أحداث `pull_request` تجاه `main` أو `staging` (مش شرط يظهر على كل push منفصل لنفس الـ SHA).

المساعدات:

| أمر | يفعل إيه |
| --- | --- |
| `pnpm run git:new-branch -- <name>` / `new-branch.ps1 -Name <name>` | فرع من `origin/staging` |
| `pnpm run git:open-pr` / `open-pr.ps1` | push + `gh pr create --base staging` |
| `pnpm run git:check-pr` | فحص يدوي يحتاج `BASE_REF` و `HEAD_REF` (مستخدم أساسًا في CI) |

---

## 15) قائمة تحقق قبل ما تقول «الحماية مانعة الدنيا»

- [ ] أنا مش بحاول أدفع `main` أو `staging` مباشرة
- [ ] فرعي متسمّي ببادئة مسموحة ومتفرّع من staging
- [ ] الـ PR قاعدته **`staging`** (إلا لو ده PR إصدار `staging`→`main`)
- [ ] عنوان الـ PR Conventional Commits
- [ ] استنيت الفحوصات تخلّص (مش Pending)
- [ ] لو Out-of-date: دمجت `origin/staging` ودفعت فرع الميزات
- [ ] معرفش `--no-verify` ولا force على المحمي

---

## 16) روابط سريعة

- الإنجليزية المختصرة: [`docs/GIT_WORKFLOW.md`](./GIT_WORKFLOW.md)
- دليل المساهمة: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- قالب الـ PR: [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md)

---

*آخر تحقق مقابل مصدر المستودع والمساعدات وفحص PR #48 الحي: سلوك `branch-flow` يرفض `feat/ui-fix` → `main` بينما فحوصات `quality` تنجح؛ الحالة `BEHIND` مرتبطة بقاعدة `main`. إصلاح المسار = إعادة توجيه القاعدة إلى `staging` ثم متابعة CI — من غير تعطيل الحماية.*
