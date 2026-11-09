export type RunOutcomeInput = {
  success: boolean;
  cancelled?: boolean;
  exitCode: number | null;
  log: string;
  artifacts: string[];
};

export type RunOutcome = {
  headline: string;
  summary: string;
  bullets: string[];
  nextSteps: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function completedWork(log: string): string[] {
  const clean = log.replace(/\u001b\[[0-9;]*m/g, "");
  const found: string[] = [];
  for (const line of clean.split(/\r?\n/)) {
    const match = /^\s*\[OK\]\s*\[([^\]]+)\]\s*(.*)$/i.exec(line);
    if (match) found.push(`${match[1]}: ${match[2]}`.trim());
    else if (/^\s*\[(?:PASS|DONE)\]\s+/i.test(line)) {
      found.push(line.trim());
    }
  }
  return unique(found).slice(0, 5);
}

function failureReason(log: string, exitCode: number | null): string {
  const clean = log.replace(/\u001b\[[0-9;]*m/g, "");
  for (const line of clean.split(/\r?\n/).reverse()) {
    const match =
      /^\s*\[Error\]\s*Fatal:\s*(.+)$/i.exec(line) ||
      /^\s*(?:Error|ResponseError):\s*(.+)$/i.exec(line) ||
      /^\s*(?:ERROR|FATAL):\s*(.+)$/i.exec(line);
    if (match?.[1]) return match[1].trim().slice(0, 240);
  }
  return `انتهى التشغيل برمز خروج ${exitCode ?? "غير متاح"} دون رسالة خطأ تفصيلية.`;
}

function explainBlocker(reason: string): string | null {
  if (/unauthorized|401/i.test(reason)) {
    return "المزوّد رفض المصادقة؛ لم يبدأ النموذج معالجة الطلب.";
  }
  if (/not installed|model.*not found/i.test(reason)) {
    return "النموذج المطلوب غير متاح محلياً؛ لم يتم استبداله بنموذج آخر.";
  }
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(reason)) {
    return "تعذّر الاتصال بمزوّد النموذج أو الشبكة.";
  }
  if (/timeout|timed out/i.test(reason)) {
    return "انتهت مهلة الانتظار قبل اكتمال الخطوة.";
  }
  return null;
}

export function summarizeRunOutcome(input: RunOutcomeInput): RunOutcome {
  const completed = completedWork(input.log);
  const artifacts = unique(input.artifacts);
  const hasFinalReport = artifacts.some((item) => /final-report|execution-result/i.test(item));
  const cancelled = input.cancelled === true;
  const reason = !input.success && !cancelled
    ? failureReason(input.log, input.exitCode)
    : "";
  const explanation = reason ? explainBlocker(reason) : null;

  const completedText = completed.length
    ? completed.join(" | ")
    : input.success
      ? "اكتمل التشغيل دون تسجيل خطوات مرحلية منفصلة."
      : "لم تُسجّل أي خطوة مكتملة قبل التوقف.";
  const artifactText = artifacts.length
    ? artifacts.join(", ")
    : "لم يُنشأ ملف مخرجات.";
  const remainingText = cancelled
    ? "لم تكتمل الخطوات اللاحقة؛ أُوقف التشغيل قبل إصدار النتيجة النهائية."
    : !input.success && !hasFinalReport
      ? "لم يصدر التقرير النهائي، وما زالت خطوات المهمة التالية غير منجزة."
      : input.success
        ? "لا توجد خطوات معلّقة مسجّلة."
        : "الخطوات التي تلي العائق لم تُنفّذ.";

  const bullets = [
    `ما تم: ${completedText}`,
    `المخرجات: ${artifactText}`,
    cancelled
      ? "الحالة: أُوقف التشغيل بطلب المالك."
      : input.success
        ? "الحالة: اكتمل التشغيل بنجاح."
        : `سبب التوقف: ${reason}`,
    ...(explanation ? [`تفسير السبب: ${explanation}`] : []),
    `ما لم يكتمل: ${remainingText}`,
  ];
  const nextSteps = cancelled
    ? [
        "راجع المخرجات المذكورة أعلاه؛ التوقف لا يحذف ما أُنجز.",
        "يمكنك تعديل المهمة أو إعادة تشغيلها بعد التأكد من المطلوب.",
      ]
    : input.success
      ? ["راجع المخرجات، ثم ابدأ مهمة جديدة عند الحاجة."]
      : [
          explanation
            ? `عالج العائق أولاً: ${explanation}`
            : "راجع سبب التوقف وسجل التشغيل لمعرفة الخطوة التي فشلت.",
          "بعد إزالة العائق، أعد تشغيل المهمة المحفوظة؛ لم تُحذف عند الفشل.",
        ];

  const headline = cancelled
    ? "أُوقف التشغيل قبل اكتمال المهمة"
    : input.success
      ? "اكتملت المهمة بنجاح"
      : "توقفت المهمة قبل إصدار التقرير النهائي";
  return {
    headline,
    bullets,
    nextSteps,
    summary: [...bullets, `الخطوة التالية: ${nextSteps[0]}`].join("\n"),
  };
}
