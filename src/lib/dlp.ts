/**
 * DLP — سياسة منع فقدان البيانات (Data Loss Prevention)
 * كشف البيانات الحساسة في المحتوى المنقول قبل الإرسال أو التخزين.
 */

import * as crypto from "crypto";

/** أنماط كشف البيانات الحساسة (regex) */
const DLP_PATTERNS: Record<string, RegExp> = {
  // أرقام بطاقات الائتمان (13-19 رقم مع مسافات أو شرطات اختيارية)
  credit_card: /\b(?:\d[ -]*?){13,19}\b/,

  // أرقام الهواتف (صيغ مختلفة)
  phone_number: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,

  // أرقام الهوية الوطنية/المدنية (10 أرقام على الأقل)
  national_id: /\b\d{10,}\b/,

  // عناوين الإيميل (اختياري للكشف عن تسريب البيانات)
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,

  // كلمات مرور في نص عادي (password=, pass=, secret=)
  plain_password: /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?\S{6,}["']?/i,

  // أرقام الضمان الاجتماعي (صيغة أمريكية)
  ssn: /\b\d{3}-\d{2}-\d{4}\b/,
};

/** نتيجة فحص DLP */
export type DLPResult = {
  /** هل المحتوى نظيف ولا يحتوي على بيانات حساسة */
  clean: boolean;
  /** أنماط البيانات الحساسة التي تم اكتشافها */
  detected: string[];
  /** عدد المطابقات لكل نمط */
  counts: Record<string, number>;
};

/** فحص محتوى نصي للبيانات الحساسة */
export function scanDLP(content: string): DLPResult {
  const detected: string[] = [];
  const counts: Record<string, number> = {};

  for (const [name, pattern] of Object.entries(DLP_PATTERNS)) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      detected.push(name);
      counts[name] = matches.length;
    }
  }

  return {
    clean: detected.length === 0,
    detected,
    counts,
  };
}

/** فحص كائن JSON للبيانات الحساسة (يقوم بمسح جميع القيم النصية) */
export function scanDLPObject(obj: unknown): DLPResult {
  const detected: string[] = [];
  const counts: Record<string, number> = {};

  function scanValue(val: unknown): void {
    if (typeof val === "string") {
      const result = scanDLP(val);
      for (const name of result.detected) {
        if (!detected.includes(name)) detected.push(name);
        counts[name] = (counts[name] || 0) + (result.counts[name] || 0);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) scanValue(item);
    } else if (val && typeof val === "object") {
      for (const key of Object.keys(val)) {
        scanValue((val as Record<string, unknown>)[key]);
      }
    }
  }

  scanValue(obj);

  return {
    clean: detected.length === 0,
    detected,
    counts,
  };
}

/** التحقق من أن المحتوى آمن للنقل (لا يحتوي على بيانات حساسة)
 * يرجع true إذا كان المحتوى آمناً، false إذا وجد بيانات حساسة */
export function isContentSafeForTransfer(content: string): boolean {
  return scanDLP(content).clean;
}

/** إنشاء بصمة (hash) للبيانات الحساسة للتخزين الآمن بدلاً من النص العادي */
export function hashSensitiveData(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** قائمة الأنماط المدعومة للإبلاغ عنها في واجهة المستخدم */
export function getSupportedPatterns(): string[] {
  return Object.keys(DLP_PATTERNS);
}
