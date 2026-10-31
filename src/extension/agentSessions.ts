import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import * as vscode from 'vscode';
import { claudeProjectDirName, SessionSummary, sessionTips, summarizeClaudeSession } from '../analysis/agentLogs';
import { commitHeadline } from '../git/history';
import { getHistory } from '../git/gitChanges';
import { reviewedCount } from './review';

// Phase 4b: AI session overview from the agent's own local logs (Claude Code first).
// Reads ONLY the log folder that belongs to the open project, read-only, after the owner
// allows it for that folder. Nothing is copied or sent anywhere.

const MAX_SESSIONS = 200;
const MAX_LOG_BYTES = 50 * 1024 * 1024;

/** A reader for one agent's local session logs. Other agents can be added behind this shape. */
interface AgentLogReader {
  agent: string;
  /** The single folder that holds this project's logs (it may not exist). */
  logFolder(projectPath: string): string;
  summarize(lines: AsyncIterable<string>, projectPath: string): Promise<SessionSummary>;
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const all: string[] = [];
  for await (const l of lines) all.push(l);
  return all;
}

const claudeCode: AgentLogReader = {
  agent: 'Claude Code',
  logFolder: (projectPath) => {
    const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    return path.join(base, 'projects', claudeProjectDirName(projectPath));
  },
  summarize: async (lines, projectPath) => summarizeClaudeSession(await collect(lines), projectPath),
};

export interface StoredSession { file: string; mtimeMs: number; size: number; summary: SessionSummary }

/** Parsed sessions, reused while the log file is unchanged. */
const cache = new Map<string, StoredSession>();

/** Reads and summarises this project's sessions, newest first. No consent check: callers must check first. */
export async function readSessions(folder: vscode.WorkspaceFolder): Promise<{ agent: string; logFolder: string; sessions: StoredSession[] }> {
  const reader = claudeCode;
  const projectPath = folder.uri.fsPath;
  const dir = reader.logFolder(projectPath);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return { agent: reader.agent, logFolder: dir, sessions: [] };
  }
  const files: { file: string; mtimeMs: number; size: number }[] = [];
  for (const e of entries) {
    // Session logs only; sub-folders and anything else are ignored.
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const file = path.join(dir, e.name);
    try {
      const st = await fs.promises.stat(file);
      if (st.size <= MAX_LOG_BYTES) files.push({ file, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      // skip unreadable entries
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sessions: StoredSession[] = [];
  for (const f of files.slice(0, MAX_SESSIONS)) {
    const key = `${f.file}\n${projectPath}`;
    let stored = cache.get(key);
    if (!stored || stored.mtimeMs !== f.mtimeMs || stored.size !== f.size) {
      const stream = fs.createReadStream(f.file, { encoding: 'utf8' });
      try {
        const summary = await reader.summarize(readline.createInterface({ input: stream, crlfDelay: Infinity }), projectPath);
        stored = { ...f, summary };
        cache.set(key, stored);
      } catch {
        continue;
      } finally {
        stream.destroy();
      }
    }
    if (stored.summary.projectLines > 0) sessions.push(stored);
  }
  sessions.sort((a, b) => b.summary.start.localeCompare(a.summary.start));
  return { agent: reader.agent, logFolder: dir, sessions };
}

const allowKey = (folder: vscode.WorkspaceFolder): string => `agentLogsAllowed:${folder.uri.toString()}`;

export function sessionsAllowed(memento: vscode.Memento, folder: vscode.WorkspaceFolder): boolean {
  return memento.get<boolean>(allowKey(folder)) === true;
}

/** Asks before the first read. Only "Yes" is remembered (in VS Code's storage, not the project). */
export async function askToAllowSessions(memento: vscode.Memento, folder: vscode.WorkspaceFolder): Promise<boolean> {
  if (sessionsAllowed(memento, folder)) return true;
  const yes = 'Yes, read the logs';
  const answer = await vscode.window.showInformationMessage(
    `Read Claude Code's session logs for "${folder.name}"?`,
    {
      modal: true,
      detail: `VibeCode Explorer will read, without changing, only this folder:\n${claudeCode.logFolder(folder.uri.fsPath)}\n\nIt shows your prompts, Claude's replies, token counts and edited file paths in the dashboard. Tool output is never shown, things that look like secrets are hidden, and nothing leaves your computer.`,
    },
    yes);
  if (answer !== yes) return false;
  await memento.update(allowKey(folder), true);
  return true;
}

/** Withdraws every permission given to this workspace's folders (session logs and notes). */
export async function resetPermissions(memento: vscode.Memento): Promise<void> {
  for (const key of memento.keys()) {
    if (key.startsWith('agentLogsAllowed:') || key.startsWith('notesAllowed:')) await memento.update(key, undefined);
  }
}

export interface SessionListResult {
  state: 'ok' | 'notAllowed' | 'restricted';
  agent: string;
  logFolder: string;
  /** `files`: changed files in this folder; `reviewed`: how many are ticked in the review checklist (Phase 14). */
  sessions: { id: string; title: string; start: string; prompts: number; tokens: number; files: number; reviewed: number }[];
  totals: { sessions: number; prompts: number; input: number; output: number; cacheRead: number; cacheWrite: number };
  topFiles: { path: string; sessions: number }[];
}

const emptyTotals = (): SessionListResult['totals'] => ({ sessions: 0, prompts: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function relInside(folder: vscode.WorkspaceFolder, file: string): string | undefined {
  const rel = path.relative(folder.uri.fsPath, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join('/');
}

/** Session list and project totals, addressed by opaque `a…` ids. */
export async function loadSessions(memento: vscode.Memento, folder: vscode.WorkspaceFolder): Promise<{ result: SessionListResult; sessions: Map<string, StoredSession> }> {
  const map = new Map<string, StoredSession>();
  const result: SessionListResult = { state: 'ok', agent: claudeCode.agent, logFolder: claudeCode.logFolder(folder.uri.fsPath), sessions: [], totals: emptyTotals(), topFiles: [] };
  if (!vscode.workspace.isTrusted) return { result: { ...result, state: 'restricted' }, sessions: map };
  if (!sessionsAllowed(memento, folder)) return { result: { ...result, state: 'notAllowed' }, sessions: map };
  const { sessions } = await readSessions(folder);
  const fileCounts = new Map<string, number>();
  sessions.forEach((st, i) => {
    const id = `a${i}`;
    map.set(id, st);
    const s = st.summary;
    const t = s.tokens;
    const paths = [...new Set(s.filesEdited.map((x) => relInside(folder, x)).filter((x): x is string => !!x))];
    result.sessions.push({
      id, title: s.title, start: s.start, prompts: s.prompts.length, tokens: t.input + t.output + t.cacheRead + t.cacheWrite,
      files: paths.length, reviewed: reviewedCount(folder, memento, st.file, paths),
    });
    result.totals.sessions++;
    result.totals.prompts += s.prompts.length;
    result.totals.input += t.input;
    result.totals.output += t.output;
    result.totals.cacheRead += t.cacheRead;
    result.totals.cacheWrite += t.cacheWrite;
    for (const f of paths) {
      fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
    }
  });
  result.topFiles = [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([p, n]) => ({ path: p, sessions: n }));
  return { result, sessions: map };
}

export interface SessionDetails {
  id: string;
  title: string;
  start: string;
  end: string;
  models: string[];
  replies: number;
  tokens: SessionSummary['tokens'];
  prompts: SessionSummary['prompts'];
  files: string[];
  hiddenFiles: number;
  commits: { shortHash: string; headline: string }[];
  securityMentions: string[];
  tips: string[];
}

/** Everything shown for one session. Commits are those authored between its first and last log line. */
export async function describeSession(folder: vscode.WorkspaceFolder, id: string, st: StoredSession): Promise<SessionDetails> {
  const s = st.summary;
  const rel = s.filesEdited.map((f) => relInside(folder, f));
  const files = rel.filter((f): f is string => !!f);
  const commits: SessionDetails['commits'] = [];
  const startMs = Date.parse(s.start);
  const endMs = Date.parse(s.end) + 5 * 60 * 1000;
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    const history = await getHistory(folder, 200);
    if (history.kind === 'ok') {
      for (const c of history.commits) {
        const t = c.date?.getTime();
        if (t !== undefined && t >= startMs && t <= endMs) commits.push({ shortHash: c.hash.slice(0, 7), headline: commitHeadline(c.message) });
      }
    }
  }
  return {
    id,
    title: s.title,
    start: s.start,
    end: s.end,
    models: s.models,
    replies: s.replies,
    tokens: s.tokens,
    prompts: s.prompts,
    files,
    hiddenFiles: rel.length - files.length,
    commits,
    securityMentions: s.securityMentions,
    tips: sessionTips(s, files),
  };
}
