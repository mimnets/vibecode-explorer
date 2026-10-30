// Pure helpers for Phase 4b: summarising an AI agent's local session log
// (no `vscode` import, unit-testable). Only the owner's prompts, the agent's reply
// text, token counts and edited file paths are used. Tool output and the agent's
// internal reasoning are never kept.

import { isSensitiveFile } from './sensitive';
import { SECRET_ASSIGNMENT, SECRET_TOKENS } from './secrets';

export interface TokenCounts { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface SessionSummary {
  title: string;
  start: string;
  end: string;
  models: string[];
  prompts: { time: string; text: string }[];
  replies: number;
  tokens: TokenCounts;
  /** Absolute paths of files the agent edited or wrote, in first-edit order. */
  filesEdited: string[];
  securityMentions: string[];
  /** Lines whose working directory is outside the project (skipped). */
  foreignLines: number;
  /** Lines that matched the project. A session with 0 is not shown. */
  projectLines: number;
}

const MAX_PROMPT_CHARS = 20000;
const MAX_MENTIONS = 50;
const MAX_MENTION_CHARS = 300;

/** Claude Code's log folder name for a project: every character other than a letter or digit becomes '-'. */
export function claudeProjectDirName(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

function normalizePath(p: string): string {
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-zA-Z]:/.test(n) ? n.toLowerCase() : n;
}

/** True when `cwd` is the project folder or inside it. */
export function isInsideProject(cwd: string, projectPath: string): boolean {
  const c = normalizePath(cwd);
  const p = normalizePath(projectPath);
  return c === p || c.startsWith(p + '/');
}

// Things that look like credentials (src/analysis/secrets.ts). Replaced before anything is displayed.
const SECRET_PATTERNS: RegExp[] = [...SECRET_TOKENS.map((t) => t.re), SECRET_ASSIGNMENT];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_match, prefix?: string) => (typeof prefix === 'string' && /[:=]\s*$/.test(prefix) ? `${prefix}[hidden]` : '[hidden]'));
  }
  return out;
}

const SECURITY_WORDS = /\b(security|secure|insecure|secrets?|credentials?|vulnerab\w*|injection|xss|csrf|csp|content security policy|sanitiz\w*|escap(?:e|ing)|validat\w*|untrusted|permissions?|authenticat\w*|authoriz\w*|encrypt\w*|path traversal|privacy|leak\w*|exploit\w*|attack\w*|safe(?:ty)?)\b/i;

/** Sentences of an agent reply that mention a security topic. */
export function securitySentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[\s>*#-]+/, '').trim())
    .filter((s) => s.length >= 12 && SECURITY_WORDS.test(s))
    .map((s) => (s.length > MAX_MENTION_CHARS ? s.slice(0, MAX_MENTION_CHARS - 1) + '…' : s));
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The text the owner typed, or undefined for tool results, commands and system lines. */
function promptText(content: unknown): string | undefined {
  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    if (content.some((c) => isObj(c) && c.type === 'tool_result')) return undefined;
    text = content.filter((c) => isObj(c) && c.type === 'text').map((c) => str((c as Json).text)).join('\n');
  } else {
    return undefined;
  }
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  // Slash-command wrappers and local command output are not prompts.
  if (!text || /^<(command-|local-command-)/.test(text)) return undefined;
  return text;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Summarises one Claude Code session log (`.jsonl`, one JSON object per line). */
export function summarizeClaudeSession(lines: Iterable<string>, projectPath: string): SessionSummary {
  const s: SessionSummary = {
    title: '', start: '', end: '', models: [], prompts: [], replies: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    filesEdited: [], securityMentions: [], foreignLines: 0, projectLines: 0,
  };
  // One reply is written as several lines (one per content block) that repeat its usage: count each reply once.
  const usageById = new Map<string, TokenCounts>();
  const models = new Set<string>();
  const files = new Set<string>();
  const mentions = new Set<string>();
  let aiTitle = '';

  for (const line of lines) {
    if (!line.trim()) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObj(o)) continue;
    if (o.type === 'ai-title' && typeof o.aiTitle === 'string') {
      aiTitle = o.aiTitle;
      continue;
    }
    const cwd = str(o.cwd);
    if (!cwd) continue;
    if (!isInsideProject(cwd, projectPath)) {
      s.foreignLines++;
      continue;
    }
    s.projectLines++;
    const time = str(o.timestamp);
    if (time) {
      if (!s.start || time < s.start) s.start = time;
      if (!s.end || time > s.end) s.end = time;
    }
    // A message typed while the agent was still working is stored as a queued command.
    if (o.type === 'attachment' && isObj(o.attachment) && o.attachment.type === 'queued_command' && o.attachment.humanTurn !== false && !o.isSidechain) {
      const text = promptText(o.attachment.prompt);
      if (text !== undefined) s.prompts.push({ time, text: redactSecrets(text.slice(0, MAX_PROMPT_CHARS)) });
      continue;
    }
    const msg = isObj(o.message) ? o.message : undefined;
    if (!msg) continue;

    if (o.type === 'user' && !o.isSidechain && !o.isMeta) {
      const text = promptText(msg.content);
      if (text !== undefined) s.prompts.push({ time, text: redactSecrets(text.slice(0, MAX_PROMPT_CHARS)) });
    } else if (o.type === 'assistant') {
      if (typeof msg.model === 'string' && !msg.model.startsWith('<')) models.add(msg.model);
      const id = str(msg.id) || str(o.uuid);
      if (isObj(msg.usage)) {
        const u = msg.usage;
        const prev = usageById.get(id);
        usageById.set(id, {
          input: Math.max(prev?.input ?? 0, num(u.input_tokens)),
          output: Math.max(prev?.output ?? 0, num(u.output_tokens)),
          cacheRead: Math.max(prev?.cacheRead ?? 0, num(u.cache_read_input_tokens)),
          cacheWrite: Math.max(prev?.cacheWrite ?? 0, num(u.cache_creation_input_tokens)),
        });
      }
      for (const block of Array.isArray(msg.content) ? msg.content : []) {
        if (!isObj(block)) continue;
        if (block.type === 'text' && !o.isSidechain) {
          for (const m of securitySentences(str(block.text))) if (mentions.size < MAX_MENTIONS) mentions.add(redactSecrets(m));
        } else if (block.type === 'tool_use' && EDIT_TOOLS.has(str(block.name)) && isObj(block.input)) {
          const file = str(block.input.file_path) || str(block.input.notebook_path);
          if (file) files.add(file);
        }
      }
    }
  }

  for (const u of usageById.values()) {
    s.tokens.input += u.input;
    s.tokens.output += u.output;
    s.tokens.cacheRead += u.cacheRead;
    s.tokens.cacheWrite += u.cacheWrite;
  }
  s.replies = usageById.size;
  s.models = [...models].sort();
  s.filesEdited = [...files];
  s.securityMentions = [...mentions];
  s.title = redactSecrets(aiTitle || s.prompts[0]?.text.split('\n', 1)[0].slice(0, 80) || '(untitled session)');
  return s;
}

/** Short, rule-based learning tips for a session. No AI is involved. */
export function sessionTips(s: SessionSummary, editedRelPaths: string[]): string[] {
  const tips: string[] = [];
  const totalInput = s.tokens.input + s.tokens.cacheRead + s.tokens.cacheWrite;
  if (s.prompts.length > 25) {
    tips.push(`This session had ${s.prompts.length} prompts. Starting a new session for each new topic keeps the context small, which saves tokens and keeps answers focused.`);
  }
  const code = editedRelPaths.filter((p) => !/\.(md|txt)$/i.test(p));
  if (code.length > 0 && !code.some((p) => /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.py$/i.test(p))) {
    tips.push('Code changed but no test files did. Asking the agent to add or run a test is a cheap way to check its work.');
  }
  if (editedRelPaths.some((p) => isSensitiveFile(p))) {
    tips.push('A file whose name looks sensitive (for example .env or a key) was edited. Make sure it is in .gitignore and never committed.');
  }
  if (s.securityMentions.length > 0) {
    tips.push(`The agent raised ${s.securityMentions.length} security point(s). Use "Add note" on the files involved to record what you decided and why.`);
  }
  const avg = s.prompts.length ? s.prompts.reduce((n, p) => n + p.text.length, 0) / s.prompts.length : 0;
  if (s.prompts.length >= 4 && avg < 40) {
    tips.push('Most prompts were very short. Saying what to change, where, and how to check it usually needs fewer follow-up prompts.');
  }
  if (totalInput > 0 && s.tokens.cacheRead / totalInput > 0.8) {
    tips.push(`${Math.round((100 * s.tokens.cacheRead) / totalInput)}% of input tokens were read from the prompt cache. Cached tokens are much cheaper than new ones, which is why long focused sessions cost less than they look.`);
  }
  if (editedRelPaths.length === 0 && s.prompts.length > 0) {
    tips.push('No files were changed in this session: it was planning or questions. Saving the outcome as a note keeps the decision next to the code.');
  }
  return tips.slice(0, 5);
}
