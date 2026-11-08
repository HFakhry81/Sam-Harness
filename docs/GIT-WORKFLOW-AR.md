# دليل Git العملي — Sam-Harness (عربي مصري)

الدليل ده يشرح **بالتفصيل العملي** إزاي تشتغل بأمان على المستودع من غير ما الحماية أو الـ hooks تمنعك، وليه شاشة الـ PR بتظهر أحيانًا «فاشل» حتى لو الكود سليم.

**المسار الإنجليزي المختصر:** [`GIT_WORKFLOW.md`](./GIT_WORKFLOW.md) · **المساهمون:** [`CONTRIBUTING.md`](../CONTRIBUTING.md)

> **مسار المشروع على جهازك (Windows):** `E:\UpNexa.com\Sam-Harness`  
> كل أوامر الـ PowerShell في الدليل مفترض تتنفّذ من جوه المجلد ده إلا لو مكتوب غير كده.  
> **فاصل اسم فرع Git دايمًا `/` مش `\`:** اكتب `feat/my-change` — متكتبش `feat\my-change`.

**تاريخ التحقق (القاهرة):** 2026-11-08 — مقابل مصدر المساعدات والـ hooks وفحص [PR #48](https://github.com/HFakhry81/Sam-Harness/pull/48) الحي.

---

## 0) وصفة سريعة من الألف للياء (رقمّيها واتبعها)

1. احفظ كل الملفات في المحرر: **Ctrl+S** أو **Ctrl+K ثم S** (Save All في VS Code / Cursor).
2. `cd E:\UpNexa.com\Sam-Harness` ثم `git status` — لازم تفهم: نظيف؟ ولا في شغل محتاج حفظ؟
3. لو الشجرة **نظيفة** وعايز فرع **جديد تمامًا** (الاسم مش موجود محلي ولا على `origin`): استخدم المساعد أو `git switch -c` (القسم 6 و 7).
4. عدّل الكود → احفظ تاني (Ctrl+S / Save All).
5. Stage **ملفات محددة** بعد مراجعة الـ diff — متستخدمش `git add -A` من غير فحص (القسم 6د).
6. `git commit -m "feat: short english summary"` (رسائل الـ commit **إنجليزي ASCII**).
7. `git push -u origin feat/my-change` (فرع الميزة فقط).
8. افتح PR بقاعدة **`staging`** عبر المساعد أو GitHub UI.
9. استنى CI يخلّص: `branch-flow` + `quality (*)` خضراء — Pending مش فشل.
10. بعد الدمج في `staging`، الإصدار لاحقًا فقط عبر PR: `staging` → `main`.

---

## 1) الفكرة في جملة

الشغل اليومي **مش** بيتدفع على `main` ولا على `staging` مباشرة.

```
feature branch (feat/* / fix/* / ...)
    -> Pull Request base = staging
    -> after CI green: merge into staging
    -> only then: release PR staging -> main
```

الحماية مش «عطلانة» — هي بترفض المسار الغلط. أشهر غلطة: فتح PR من `feat/...` **مباشرة على `main`**.

---

## 2) المصطلحات: حفظ ≠ Stage ≠ Commit ≠ Push ≠ PR ≠ Merge

| الخطوة | معناها | بيحصل فين؟ |
| --- | --- | --- |
| **Save (حفظ)** | كتابة الملف على الديسك من المحرر | محلي — Git لسه ممكن يشوفه unmodified لو ما اتحفظش |
| **Stage** | اختيار مسارات معيّنة للـ commit (`git add path`) | محلي — منطقة التجهيز |
| **Commit** | تسجيل لقطة محلية برسالة إنجليزية | محلي على فرعك |
| **Push** | رفع الـ commits للـ remote | مسموح على **فرع الميزة**؛ مرفوض على `main`/`staging` |
| **Pull Request (PR)** | طلب مراجعة/دمج بين فرعين على GitHub | مش دمج تلقائي |
| **Merge** | دمج الـ PR (أو دمج فرع في فرع محليًا) | بعد المراجعات + فحوصات CI المطلوبة للدمج على GitHub |

**قبل أي تبديل فرع أو merge:**

1. Save All في المحرر (**Ctrl+S** أو **Ctrl+K ثم S**).
2. `git status` — لو في تعديلات، إمّا commit آمن أو `stash` واعي (القسم 6ب)، ومتكملش وانت مش فاهم الحالة.

الحفظ في Cursor/VS Code **مش** بيعمل commit. والـ commit لوحده **مش** بيرفع من غير push.

---

## 3) الممرات الثلاثة (Lanes)

| الفرع | الدور |
| --- | --- |
| `feat/*`, `fix/*`, `chore/*`, `docs/*`, `feature/*`, `hotfix/*`, `cursor/*`, … | شغل يومي. **يتفرّع من أحدث `staging`** |
| `staging` | دمج التكامل قبل الإنتاج |
| `main` | الإنتاج / الإصدار — يتحدث **فقط** عبر PR إصدار من `staging` |

**ملاحظة مهمة:** مش مطلوب إن `main` و `staging` يكون ليهم **نفس الـ SHA**. بعد دمج إصدار، `main` غالبًا فيه merge commit مختلف عن رأس `staging` حتى لو المحتوى متوافق.

---

## 4) طبقات الحماية (ليه الدفع/الدمج بيتمنع)

1. **حماية فروع GitHub** على `main` و `staging`: ممنوع push مباشر؛ مطلوب PR؛ مطلوب فحوصات؛ مطلوب الفرع محدّث (strict up-to-date).
2. **فحص CI اسمه `branch-flow`:** يفشل لو قاعدة الـ PR غلط أو اسم الفرع/العنوان مخالف للقواعد.
3. **Hooks محلية** في [`.githooks/`](../.githooks/) (بتتفع مع `pnpm install` / `prepare`):
   - `pre-push`: يمنع الدفع لـ `main`/`staging` ويمنع أسماء فروع غير مسموحة.
   - `commit-msg`: يلزم Conventional Commits؛ **يستثني** الرسائل اللي بتبدأ بـ `Merge ` أو `Revert ` أو `fixup!` / `squash!` (متحقق من [`.githooks/commit-msg`](../.githooks/commit-msg) بتاريخ 2026-11-08).
4. **المساعدات:** `git:new-branch` و `git:open-pr` دايمًا بتبدأ من / بتفتح على **`staging`**.

| الاسم في GitHub | المعنى |
| --- | --- |
| `quality (ubuntu-latest)` | typecheck + اختبارات |
| `quality (windows-latest)` | نفس الشيء + PowerShell Tools |
| `quality (macos-latest)` | نفس المصفوفة |
| **`branch-flow`** | حراسة المسار/الاسم/العنوان |

**ممنوع:** `--no-verify`، force push على المحمي، تعطيل الحماية، أو حذف قواعد الـ checks عشان «تعدّي».

---

## 5) تجهيز الجهاز (مرة واحدة / عند اللزوم)

```powershell
cd E:\UpNexa.com\Sam-Harness
pnpm install
pnpm run git:setup-hooks
git config --get core.hooksPath
# expected: .githooks
```

### متطلبات اختيارية لـ `gh`

المساعد `open-pr` يحتاج [GitHub CLI](https://cli.github.com/):

```powershell
gh --version
gh auth status
```

- Classic PAT: scope `repo`
- Fine-grained: **Contents** + **Pull requests** (read/write) على هذا المستودع
- لو الحساب غلط: `gh auth login`

من غير `gh` تقدر تعمل commit/push لفرع الميزة وتفتح الـ PR من واجهة GitHub — بشرط **base = `staging`**.

---

## 6) بداية يوم آمنة

### أ) شجرة نظيفة — فرع جديد من أحدث staging

```powershell
cd E:\UpNexa.com\Sam-Harness
# Save All in the editor first (Ctrl+S / Ctrl+K then S)
git fetch origin
git status
```

قبل إنشاء الاسم، تأكد إنه **مش موجود**:

```powershell
git branch --list "feat/my-change"
git ls-remote --heads origin "feat/my-change"
```

لو الاتنين فاضيّين (مفيش مخرجات للاسم ده)، تقدر تستخدم المساعد:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\git\new-branch.ps1 -Name feat/my-change
```

أو:

```powershell
pnpm run git:new-branch -- feat/my-change
```

#### تحذير حرج عن المساعد و`-B`

المساعد من المصدر ينفّذ تقريبًا: `git fetch origin staging` ثم **`git checkout -B <name> origin/staging`**.

- `-B` يعني: لو الاسم موجود محليًا، Git **هيحوّل الفرع الموجود ليشير لأحدث staging** (reset لمؤشر الفرع) — ده خطر على شغل قديم على نفس الاسم.
- استخدم المساعد **فقط** لاسم فرع **جديد وفريد** غير موجود محليًا ولا على `origin`.
- **متشغّلش** `git:new-branch` / `new-branch.ps1` على اسم موجود زي `feat/ui-fix`.
- الدليل اليدوي **مش** بيستخدم `-B` أصلًا (شوف القسم 7).

أسماء مسموحة (أمثلة): `feat/...`, `fix/...`, `chore/...`, `docs/...`, `feature/...`, `hotfix/...`, `cursor/...`.

### ب) تعديلات محلية على `main` أو `staging` (وسخ) — احفظ الشغل بأمان

1. Save All (**Ctrl+S** / **Ctrl+K ثم S**).
2. `git status` وافهم الملفات.
3. **متستخدمش** `git reset --hard` ولا `git clean -fd` كحل افتراضي.

`stash` آمن نسبيًا للشغل المتتبّع + غير المتتبّع (مع `-u`)، مع حدود مهمة:

```powershell
cd E:\UpNexa.com\Sam-Harness
git status
git stash push -u -m "wip before leaving protected branch"
```

- `git stash -u` **مش** بيضم الملفات الـ **ignored** (مثل `.env` حسب [`.gitignore`](../.gitignore)). الأسرار المحلية المتجاهلة تفضل في مكانها — متفترضش إن الـ stash خدها.
- بعد ما تفتح فرع ميزة جديد فريد:

```powershell
git fetch origin staging
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\git\new-branch.ps1 -Name feat/my-change
git stash pop
```

- لو `stash pop` عمل تعارضات: حلّها، `git add` للمسارات المحلولة، وكمل. **الـ stash entry غالبًا بيفضل موجود بعد pop فاشل/متعارض — متعملش `stash drop` غير لما تتأكد إن الشغل رجع سليم.**
- بديل أوضح من غير مخاطر النسخ العشوائي: خلّص commit على فرع ميزة بأسرع ما يمكن، أو سيب الملفات المفتوحة واتأكد إنها محفوظة، وانقل الشغل عبر `stash` الواعي أعلاه فقط.

### ج) فرع موجود أصلًا زي `feat/ui-fix` — متضيعش الشغل ومتعدّيش بالمساعد

```powershell
cd E:\UpNexa.com\Sam-Harness
# Save All first
git fetch origin
git switch feat/ui-fix
# or: git checkout feat/ui-fix
git status
```

حدّثه من staging بـ **merge** (القسم 9). **متستدعِيش** `new-branch` على نفس الاسم.

### د) Stage و commit بأمان (من غير أسرار)

بعد الحفظ:

```powershell
git status
git diff
git add docs/GIT-WORKFLOW-AR.md
# add only the paths you intend — repeat per path as needed
git diff --staged
git commit -m "feat: short english summary"
```

- راجع `git diff --staged` قبل الـ commit؛ لو ظهر مسار أسرار (مثل `.env`) أو مفتاح، شيله من الـ stage فورًا: `git restore --staged <path>`.
- **تحذير:** `git add -A` أو `git add .` من غير مراجعة يسهل إدخال أسرار أو ملفات مش مقصودة. استخدم مسارات صريحة بعد الفحص.
- كل أمثلة رسائل الـ commit والـ console في الدليل **إنجليزي ASCII** (الـ hooks وCI متوقعين كده).

فتح PR بعد الدفع:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\git\open-pr.ps1 -Title "feat: short english summary"
```

**سلوك `open-pr.ps1` المتحقّق:** يدفع الفرع الحالي ثم `gh pr create --base staging --head <branch>`. يرفض الفتح من `main` أو `staging`.

---

## 7) أوامر يدوية مكافئة (بدون المساعد) — فرع جديد فقط

**متستخدمش** `git checkout -B` هنا. للفرع الجديد بعد التأكد إنه مش موجود:

```powershell
cd E:\UpNexa.com\Sam-Harness
git fetch origin staging
git switch -c feat/my-change origin/staging
# equivalent: git checkout -b feat/my-change origin/staging
```

لو الاسم موجود، الأوامر دي هتفشل بأمان بدل ما تعيد ضبط فرع قديم — وده المطلوب.

ثم:

```powershell
git add path\to\file.ext
git diff --staged
git commit -m "feat: my change"
git push -u origin feat/my-change
```

فتح PR (مع `gh`):

```powershell
gh pr create --base staging --head feat/my-change --title "feat: my change" --body "## Summary`n- describe change"
```

أو من GitHub: New Pull Request → **base = `staging`** ← compare = فرع الميزتك.

---

## 8) قراءة شاشة الـ PR

| اللي بتشوفه | المعنى |
| --- | --- |
| **Checks / branch-flow = fail** | مسار/قاعدة/عنوان الـ PR مخالف للقواعد — غالبًا مش معناه إن الكود معطوب |
| **quality (*) = pass/green** | الاختبارات عدّت |
| **Out-of-date / Behind** | رأس فرعك مش محدّث بالنسبة لفرع **القاعدة (base)** |
| **Merge blocked** | مطلوب فاشل أو متأخر أو تعارض |

- **Failure:** الفحص خلص ورفض.
- **Pending / Queued / In progress:** لسه بيشتغل — استنى.

---

## 9) تحديث فرع ميزة متأخر: ادمج `origin/staging` (مش rebase)

السياسة: **merge** من staging داخل فرع **الميزة**، من غير rebase ومن غير force push.

```powershell
cd E:\UpNexa.com\Sam-Harness
# Save All + git status clean or understood
git switch feat/ui-fix
git fetch origin staging
git merge origin/staging -m "chore: merge staging into feature"
```

### ماذا عن الـ hook ورسالة الـ merge؟

من [`.githooks/commit-msg`](../.githooks/commit-msg) (تحقق 2026-11-08):

- الرسالة الافتراضية اللي بتبدأ بـ `Merge ` **مقبولة** (استثناء صريح).
- ومع ذلك الدليل بيستخدم رسالة conventional صريحة: `chore: merge staging into feature` عشان الوضوح والاتساق مع بقية السجل.

لو ظهرت تعارضات:

1. حل الملفات المتعارضة.
2. `git add path\to\resolved.ext` (مسارات صريحة).
3. كمّل بـ:

```powershell
git commit -m "chore: merge staging into feature"
```

4. `git push` لفرع الميزتك (من غير `--force`).

### إلغاء الـ merge بأمان (قبل اكتمال الـ merge commit)

```powershell
git merge --abort
```

**متستخدمش** على المحمي: `git push --force`، `git reset --hard` عشوائي، أو تعطيل الـ hooks.

---

## 10) إصلاح PR مفتوح على قاعدة غلط (تعليمات فقط — مثال PR #48)

### اللي اتأكد من GitHub مباشرة (القاهرة 2026-11-08)

على **[PR #48](https://github.com/HFakhry81/Sam-Harness/pull/48)**:

| العنصر | القيمة المتحققة |
| --- | --- |
| العنوان | `fix: UI Fix` (Conventional Commits مقبول) |
| الرأس (head) | `feat/ui-fix` @ `0f52adad824ce51583de44405b4feed6cab0ce85` |
| القاعدة (base) | **`main`** ← المشكلة الأساسية |
| `branch-flow` | **FAILURE** — *PRs into main must come from staging (got head='feat/ui-fix')* |
| `quality` (ubuntu / windows / macos) | **SUCCESS** |
| حالة الدمج | `BEHIND` / out-of-date بالنسبة لقاعدة `main` |

**الحماية شغّالة صح**؛ المسار هو الغلط.

### المطلوب منك (الوكيل مش بيغيّر PR #48)

1. غيّر قاعدة الـ PR إلى `staging` من واجهة GitHub (Edit بجانب base)، أو لو مصرّح لنفسك:

   ```powershell
   gh pr edit 48 --base staging
   ```

2. استنى إعادة تشغيل الفحوصات. مع base=`staging` والفرع/العنوان المقبولين، `branch-flow` المفروض يعدّي.

3. لو ظهر **Out-of-date مقابل staging**: نفّذ القسم 9 على `feat/ui-fix` ثم push.

4. **متدمجش في `main` من الفرع ده.** الإصدار لاحقًا: PR `staging` → `main` بعد ما الميزة تبقى جوه staging وCI أخضر.

5. بديل: اقفل #48 من الواجهة (من غير حذف الفرع)، وحدّث الفرع، وافتح PR جديد بقاعدة `staging`.

---

## 11) مسار الإصدار — وإيه اللي **مش** بيتصلّح بدمج staging في فرع ميزة

### المسار الصحيح للإصدار

1. الميزات اتنقلت لـ `staging` عبر PRs خضراء.
2. افتح PR إصدار: **head = `staging`**, **base = `main`**.
3. استنى `quality (*)` و **`branch-flow`** على رأس `staging` الحالي.
4. ادمج الإصدار.
5. تساوي SHA بين `main` و `staging` **مش** شرط نجاح.

### سيناريو «الإصدار Behind / Out-of-date على main» — متتلخبطش

لو PR الإصدار `staging` → `main` ظاهر **Behind**:

- أمر زي `git merge origin/staging` وأنت أصلًا على `staging` **مش** بيحل تأخر `staging` عن `main`. ده مش نفس وصفة فرع الميزة.
- المسار المسموح لإعادة التوفيق لما `main` فيه commits مش في `staging` (حسب تدفق المستودع): افتح فرع صيانة مسموح (مثلًا `sync/...` أو `chore/...`) **من أحدث staging**، وادمج فيه **`origin/main`** برسالة صريحة، ادفع الفرع، وافتح PR قاعدته **`staging`**. بعد ما ده يتدمج وCI يخضر، رجّع افتح/حدّث PR الإصدار `staging` → `main`.
- مثال آمن (بعد Save All + شجرة مفهومة + اسم فرع جديد فريد):

```powershell
git fetch origin
git switch -c sync/reconcile-main origin/staging
git merge origin/main -m "chore: merge main into sync branch"
# resolve conflicts if any, then:
# git add <paths>
# git commit -m "chore: merge main into sync branch"
git push -u origin sync/reconcile-main
# then open PR base=staging (helper or gh)
```

- لو الوضع مش واضح أو الحماية رافضة مسار معيّن: **وقف، متلفّش على القواعد، ومتعطلش checks** — صعّد للمالك/المراجعة. مفيش أمر واحد لفرع ميزة «بيصلّح دايمًا» مشاكل الإصدار.

---

## 12) جدول أعطال شائعة وحلولها

| العرض | السبب الشائع | الحل |
| --- | --- | --- |
| Push مرفوض على `main`/`staging` | حماية + `pre-push` | فرع ميزة + PR لـ staging |
| `branch-flow`: *must come from staging* | PR للـ main من `feat/...` | غيّر base إلى `staging` (§10) |
| `branch-flow`: اسم فرع | بادئة غير مسموحة | فرع جديد باسم مسموح |
| `commit-msg` رفض | مش Conventional Commits | مثلًا: `fix: UI Fix` |
| Out-of-date على **feature → staging** | فرع الميزة متأخر | `git merge origin/staging -m "chore: merge staging into feature"` |
| Out-of-date على **staging → main** | اختلاف تاريخ الإصدار | §11 — مش نفس وصفة الميزة |
| المساعد رفض dirty tree | تعديلات غير متسجّلة | Save + commit أو stash واعي قبل فرع **جديد** |
| استخدام المساعد على اسم موجود | `-B` يعيد ضبط الفرع | متستخدمهوش؛ `git switch` للاسم الموجود |

---

## 13) تحديث محلي لـ `main` / `staging` (مش read-only) + تنظيف الفروع

### تحديث الفروع المحمية محليًا — fast-forward فقط

هذا **تحديث محلي لمتابعتك** (يجيب commits من `origin`)، مش قراءة فقط. نفّذه من **شجرة نظيفة** فقط:

```powershell
cd E:\UpNexa.com\Sam-Harness
# Save All, then:
git status
# must be clean before switching/updating protected branches
git fetch origin

git switch main
git pull --ff-only origin main
# if this errors about non-fast-forward: STOP.
# Do not reset/force. Investigate or escalate — local main diverged.

git switch staging
git pull --ff-only origin staging
# same rule: stop on divergence; no --no-ff pull, no force
```

`-ff-only` يفشل بأمان لو تاريخك المحلي اتفرّع عن الـ remote بدل ما يعمل merge محلي غير مرغوب على فرع محمي.

### حذف فرع ميزة بعد الدمج

بعد التأكد إن الشغل اتنقل وCI كان أخضر:

```powershell
git push origin --delete feat/old-done
git branch -d feat/old-done
```

قبل الحذف لو مش متأكد:

```powershell
git fetch origin
git log --oneline origin/staging..feat/maybe-important
```

لو في commits ظاهرة، متتحذفش قبل ما تتأكد إنها اتنقلت أو مش محتاجها. `main` و `staging` **متتحذفوش**.

---

## 14) مرجع سريع: قواعد `branch-flow` من المصدر

من [`scripts/git/check-pr-flow.sh`](../scripts/git/check-pr-flow.sh) و [`lib-branch-flow.sh`](../scripts/git/lib-branch-flow.sh) و [`.github/workflows/branch-flow.yml`](../.github/workflows/branch-flow.yml):

- **base = main** → لازم **head = staging** فقط.
- **base = staging** → head فرع ميزة ببادئة مسموحة.
- عنوان الـ PR: Conventional Commits؛ الإصدار يقبل كمان `Release ...`.
- الـ workflow على أحداث `pull_request` تجاه `main` أو `staging`.

| أمر | يفعل إيه |
| --- | --- |
| `pnpm run git:new-branch -- <name>` / `new-branch.ps1 -Name <name>` | فرع من `origin/staging` عبر `-B` — **لاسم جديد فقط** |
| `pnpm run git:open-pr` / `open-pr.ps1` | push + `gh pr create --base staging` |
| `pnpm run git:check-pr` | فحص CI اليدوي (`BASE_REF` / `HEAD_REF`) |

---

## 15) قائمة تحقق سريعة

- [ ] Save All قبل التبديل/الدمج
- [ ] `git status` مفهوم (نظيف أو شغل محفوظ بوعي)
- [ ] مش بدفع `main`/`staging` مباشرة
- [ ] فرع جديد فريد من staging (أو fort على فرع موجود من غير `-B`/المساعد)
- [ ] PR base = **`staging`** (إلا إصدار `staging`→`main`)
- [ ] رسائل commit إنجليزي Conventional Commits
- [ ] Stage بمسارات صريحة + مراجعة `git diff --staged`
- [ ] CI خلص (مش Pending)
- [ ] مفيش `--no-verify` ولا force على المحمي

---

## 16) روابط سريعة

- الإنجليزية المختصرة: [`docs/GIT_WORKFLOW.md`](./GIT_WORKFLOW.md)
- دليل المساهمة: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- قالب الـ PR: [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md)
- مثال التحقق: [PR #48](https://github.com/HFakhry81/Sam-Harness/pull/48)

---

*تحقق القاهرة 2026-11-08: `branch-flow` يرفض `feat/ui-fix` → `main` بينما `quality` تنجح؛ الحالة `BEHIND` مرتبطة بقاعدة `main`. Hook الـ `commit-msg` يسمح بموضوع يبدأ بـ `Merge ` ويستلزم غير ذلك Conventional Commits. إصلاح المسار = إعادة توجيه القاعدة إلى `staging` ثم CI — من غير تعطيل الحماية.*
