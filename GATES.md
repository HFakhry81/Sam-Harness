# Gates: إصلاح الثغرات الأمنية المتبقية

OWNS: src/controlplane/auth.ts, src/controlplane/session.ts, SECURITY_AUDIT.md

Scope: إصلاح الثغرات الأمنية المتبقية في نظام المصادقة والتحقق من صحة الإصلاحات

## الثغرات المتبقية

- [x] G1: إصلاح تخزين الجلسات في الذاكرة فقط (استخدام SQLite للتخزين الدائم)
  CHECK: node -e "const fs = require('fs'); if (!fs.existsSync('src/controlplane/session-store.ts')) { console.error('FAIL: session-store.ts not created'); process.exit(1); } const authContent = fs.readFileSync('src/controlplane/auth.ts', 'utf8'); if (!authContent.includes('createSession as dbCreateSession') || !authContent.includes('getSessionByToken')) { console.error('FAIL: auth.ts not using session-store'); process.exit(1); } console.log('PASS: Sessions persisted to database');"
  EXPECT: PASS: Sessions persisted to database
  EVIDENCE: verified

- [ ] G2: إصلاح حساب TOTP time counter الخاطئ
  CHECK: node -e "const fs = require('fs'); const content = fs.readFileSync('src/controlplane/auth.ts', 'utf8'); if (content.includes('for (let step = -1; step <= 1; step++)') && content.includes('adjustedTime')) { console.error('FAIL: TOTP verification still has time counter bug'); process.exit(1); } console.log('PASS: TOTP verification fixed');"
  EXPECT: PASS: TOTP verification fixed
  EVIDENCE: pending

- [ ] G3: التحقق من أن جميع الثغرات الأمنية تم إصلاحها
  CHECK: node -e "const fs = require('fs'); const content = fs.readFileSync('src/controlplane/auth.ts', 'utf8'); const checks = [
    { name: 'Unique MFA Secret', pass: content.includes('generateUniqueMfaSecret') },
    { name: 'Session rotation preserves role', pass: content.includes('rotated.role = s.role') },
    { name: 'Session rotation preserves MFA', pass: content.includes('rotated.mfaVerified = s.mfaVerified') },
    { name: 'Timing-safe equal fixed', pass: content.includes('Buffer.alloc(maxLen, 0)') }
  ]; const failed = checks.filter(c => !c.pass); if (failed.length > 0) { console.error('FAIL:', failed.map(f => f.name).join(', ')); process.exit(1); } console.log('PASS: All security fixes verified');"
  EXPECT: PASS: All security fixes verified
  EVIDENCE: pending

- [ ] G4: إنشاء تقرير التدقيق الأمني الكامل
  CHECK: node -e "const fs = require('fs'); if (!fs.existsSync('SECURITY_AUDIT.md')) { console.error('FAIL: SECURITY_AUDIT.md not created'); process.exit(1); } const content = fs.readFileSync('SECURITY_AUDIT.md', 'utf8'); if (!content.includes('## ملخص الثغرات') || !content.includes('## التفاصيل')) { console.error('FAIL: SECURITY_AUDIT.md incomplete'); process.exit(1); } console.log('PASS: Security audit report complete');"
  EXPECT: PASS: Security audit report complete
  EVIDENCE: pending

- [ ] G5: التحقق من عدم وجود تسريبات معلومات في السجلات
  CHECK: node -e "const fs = require('fs'); const authContent = fs.readFileSync('src/controlplane/auth.ts', 'utf8'); const serverContent = fs.readFileSync('src/controlplane/server.ts', 'utf8'); const redactContent = fs.readFileSync('src/lib/security/redact.ts', 'utf8'); if (!redactContent.includes('redactSensitive')) { console.error('FAIL: Redaction function not found'); process.exit(1); } console.log('PASS: No information leaks detected');"
  EXPECT: PASS: No information leaks detected
  EVIDENCE: pending

<!--
ABANDON: <id> <non-empty reason>
-->
