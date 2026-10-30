# Phase 8 — Team customization, hybrid routing, Linux/macOS desktop

**الهدف / Goal:** إغلاق فجوات المساعدة (أدوار/نماذج، هجين حي، سطح مكتب يونكس، تخصيص الفريق بدون كود).

---

## 1) نماذج لكل دور (`config/team.json`)

| المصدر | السلوك |
| --- | --- |
| `config/team.json` | لكل دور: `models.local` / `models.cloud` / `models.free` |
| المخطط | `config/team.schema.json` + تحقق وقت التشغيل |
| البيئة | `SAM_ROLE_<ROLE>_MODEL` (محلي)، `_CLOUD_MODEL`، `_FREE_MODEL` |
| الافتراضيات | تطابق السلوك السابق (`gemma4:cloud`, `gemma3:1b`, `qwen2.5:1.5b`, …) |

أمثلة:

```bash
SAM_ROLE_STRATEGIST_MODEL=qwen2.5-coder:7b
SAM_ROLE_AUDITOR_CLOUD_MODEL=gemma4:cloud
```

المصانع `makeCeoModel` / `makeSpecialistModel` تقرأ الفريق تلقائياً.

---

## 2) توجيه هجين حي + سقف التكلفة

الأولوية:

1. `FORCE_LOCAL_SPECIALISTS` / وضع `local` العام  
2. **سقف التكلفة دائماً يفوز** (`$0.50` افتراضي / قرب السقف → محلي أو مجاني)  
3. خريطة `hybrid-profile.roles[role]` (`local` \| `cloud` \| `auto`)  
4. صعوبة المهمة (Phase 5) + `prefersCloud` من عقد الدور / الفريق  

واجهات:

| Endpoint | الدور |
| --- | --- |
| `GET /api/routing/effective` | قرار التوجيه لكل دور |
| `GET /api/hybrid-profile` | يتضمن `routing` |
| `pnpm run doctor` | فحص `Per-role routing` + `Team config` |

---

## 3) مشغّل سطح المكتب Linux / macOS

| المنصة | الخلفية | الأدوات |
| --- | --- | --- |
| Windows | `windows-uia` (كما في Phase 4) | PowerShell + UIA |
| Linux | `linux-x11-wayland` | `wmctrl` / `xdotool` / `ydotool` · لقطات `grim`/`scrot`/`gnome-screenshot` · اختياري `python3-pyatspi` |
| macOS | `macos-accessibility` | `osascript` + `screencapture` + `pbcopy`/`pbpaste` |
| اختبارات | `SAM_DESKTOP_BACKEND=mock` | أي نظام |

عند غياب الأدوات: أخطاء واضحة مع تلميح التثبيت — لا stubs صامتة.

`run_shell` أصبح متعدد المنصات: PowerShell/cmd على Windows، `bash -lc` على Linux/macOS، بنفس سياسة القائمة البيضاء (بدون أنابيب على يونكس).

موافقات Phase 6 للتطبيقات الحساسة ما زالت سارية.

### حزم Ubuntu مقترحة

```bash
sudo apt install wmctrl xdotool scrot gnome-screenshot xclip python3-pyatspi
# Wayland (اختياري):
sudo apt install grim wl-clipboard ydotool
```

---

## 4) تخصيص الفريق والمسار بدون كود

- CRUD عبر `GET/PUT /api/team`، `POST /api/team/roles`، `DELETE /api/team/roles/:id`، `POST /api/team/pipeline`
- واجهة Control Plane → تبويب **الفريق** (RTL عربي)
- إعادة ترتيب / تعطيل خطوات ما بعد `APPROVED`؛ أدوار مخصّصة بـ `prompt` + نموذج
- **ثوابت:** حلقة المراجعة (strategist↔auditor ≤5) وبوابة GO لا تُلغى

سجل تدقيق: `team_config.save` / `team_role.upsert` / `team_role.delete`

---

## 5) اختبارات

```bash
pnpm test -- tests/phase8-team-routing.test.ts tests/phase8-desktop-unix.test.ts
```

بدون شبكة؛ بناء أوامر Linux/macOS بـ mock exec.

---

## ملفات رئيسية

```text
config/team.json
config/team.schema.json
src/agency/teamConfig.ts
src/lib/cost/router.ts          # roles map + prefersCloud + cap
src/agent/models.ts             # effectiveRoutingDecisions
src/tools/desktop/backends/linux.ts
src/tools/desktop/backends/macos.ts
src/tools/desktop/backends/unixDetect.ts
src/controlplane/public/        # تبويب الفريق
docs/help/{ar,en}/              # محدّث
```
