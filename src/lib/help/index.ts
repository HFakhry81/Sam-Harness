export {
  HELP_TOPICS,
  HELP_TOPIC_IDS,
  resolveTopicId,
  topicMeta,
  helpDocsRoot,
  helpLocaleDir,
  helpDocPath,
  parseHelpMarkdown,
  loadHelpDoc,
  tryLoadHelpDoc,
  listHelpIndex,
  verifyHelpIntegrity,
  normalizeHelpLocale,
  type HelpLocale,
  type HelpDoc,
  type HelpIndexEntry,
  type HelpIntegrityIssue,
  type HelpTopicId,
  type HelpTopicMeta,
} from "./catalog.js";

export { searchHelp, scoreHelpDoc, type HelpSearchHit } from "./search.js";

export {
  detectHelpIntent,
  answerHelpQuery,
  formatHelpAnswerForCli,
  helpIntentCues,
  type HelpAnswer,
} from "./answer.js";

export { markdownToHtml, wrapHelpHtml, helpShellCss } from "./render.js";

export {
  exportHelpLocale,
  exportAllHelp,
  type HelpExportResult,
} from "./export.js";
