import { agentTaskListSchema, agentTaskSchema, isTerminal, type AgentTask } from '@contracts/gcp/agent';
import type { GcpObservationClient } from './observation-client';

type Call = GcpObservationClient['agentCall'];
export type AgentBoard = { items: AgentTask[]; selectedId?: string; error?: string; busy: boolean };

/** Small store for the agent dashboard: send an instruction, poll the stored task, decide. Never keeps a decision key across attempts it did not make. */
export class AgentClient {
  private value: AgentBoard = { items: [], busy: false };
  private readonly listeners = new Set<() => void>(); private timer?: ReturnType<typeof setTimeout>; private closed = false; private generation = 0;
  private readonly call: Call; private readonly interval: number;
  constructor(call: Call, interval = 1500) { this.call = call; this.interval = interval; }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<AgentBoard>) { if (this.closed) return; this.value = { ...this.value, ...patch }; this.listeners.forEach(fn => fn()); }
  private upsert(task: AgentTask) { const items = [task, ...this.value.items.filter(item => item.id !== task.id)].slice(0, 20); this.set({ items, selectedId: task.id }); }
  private fail(error: unknown) { this.set({ busy: false, error: error instanceof Error && /^[a-z_]{1,64}$/.test(error.message) ? error.message : 'request_failed' }); }
  /** Effects may run twice (React StrictMode), so closing only stops the timer and a later open() resumes. */
  open() { this.closed = false; }
  close() { this.closed = true; this.generation++; clearTimeout(this.timer); }
  select(id: string) { if (this.value.items.some(item => item.id === id)) { this.set({ selectedId: id }); this.watch(); } }

  async load() {
    try { const list = agentTaskListSchema.parse(await this.call('/agent-tasks')); this.set({ items: list.items, selectedId: this.value.selectedId ?? list.items[0]?.id, error: undefined }); this.watch(); }
    catch (error) { this.fail(error); }
  }
  async send(instruction: string, language: 'ko' | 'en') {
    if (this.value.busy || !instruction.trim()) return;
    this.set({ busy: true, error: undefined });
    try { const task = agentTaskSchema.parse(await this.call('/agent-tasks', { key: crypto.randomUUID(), body: { instruction: instruction.trim(), language } })); this.set({ busy: false }); this.upsert(task); this.watch(); }
    catch (error) { this.fail(error); }
  }
  async decide(id: string, decision: 'approve' | 'reject') {
    if (this.value.busy) return;
    this.set({ busy: true, error: undefined });
    try { const task = agentTaskSchema.parse(await this.call(`/agent-tasks/${id}/decision`, { key: crypto.randomUUID(), body: { decision } })); this.set({ busy: false }); this.upsert(task); this.watch(); }
    catch (error) { this.fail(error); }
  }
  /** Poll the selected task while the crew is working. A terminal state stops polling. */
  private watch() {
    clearTimeout(this.timer); const generation = ++this.generation;
    const selected = this.value.items.find(item => item.id === this.value.selectedId);
    if (this.closed || !selected || isTerminal(selected.state) || selected.state === 'awaiting_approval' && Date.parse(selected.approval?.expiresAt ?? '') <= Date.now()) return;
    this.timer = setTimeout(async () => {
      if (generation !== this.generation || this.closed) return;
      try { const task = agentTaskSchema.parse(await this.call(`/agent-tasks/${selected.id}`)); if (generation === this.generation) { this.upsert(task); this.watch(); } }
      catch (error) { if (generation === this.generation) this.fail(error); }
    }, this.interval);
  }
}
