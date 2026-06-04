"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getTask, cancelTask, retryTask, submitTaskInput, subscribeToTaskEvents } from "@/lib/api-client";
import type { Task, TaskEvent, TaskEventType } from "@promptqueue/core";
import {
  ArrowLeft,
  AlertCircle,
  Clock,
  Play,
  CheckCircle2,
  XCircle,
  RefreshCw,
  MessageSquare,
  Terminal,
  Wrench,
} from "lucide-react";

const eventIcons: Record<string, React.ReactNode> = {
  created: <Clock className="h-4 w-4 text-muted-foreground" />,
  started: <Play className="h-4 w-4 text-primary" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  retrying: <RefreshCw className="h-4 w-4 text-yellow-500" />,
  cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
  timed_out: <XCircle className="h-4 w-4 text-destructive" />,
  agent_text: <MessageSquare className="h-4 w-4 text-blue-500" />,
  agent_thinking: <MessageSquare className="h-4 w-4 text-purple-500" />,
  agent_tool_call: <Wrench className="h-4 w-4 text-yellow-600" />,
  agent_tool_result: <Terminal className="h-4 w-4 text-green-600" />,
};

function groupEventsIntoTurns(events: TaskEvent[]): TaskEvent[][] {
  const turns: TaskEvent[][] = [];
  let currentTurn: TaskEvent[] = [];

  for (const event of events) {
    const isAgentEvent = event.eventType.startsWith("agent_");

    if (!isAgentEvent) {
      if (currentTurn.length > 0) {
        turns.push([...currentTurn]);
        currentTurn = [];
      }
      turns.push([event]);
      continue;
    }

    if (event.eventType === "agent_text" && currentTurn.length > 0) {
      const lastInTurn = currentTurn[currentTurn.length - 1];
      if (lastInTurn?.eventType === "agent_tool_result") {
        turns.push([...currentTurn]);
        currentTurn = [];
      }
    }

    currentTurn.push(event);
  }

  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }

  return turns;
}

function AgentEventContent({ event }: { event: TaskEvent }) {
  const payload = event.payload ?? {};

  if (event.eventType === "agent_text") {
    return (
      <div className="mt-1 rounded bg-blue-500/10 p-2 font-mono text-xs text-blue-200 whitespace-pre-wrap">
        {typeof payload.content === "string" ? payload.content : JSON.stringify(payload.content)}
      </div>
    );
  }

  if (event.eventType === "agent_thinking") {
    return (
      <div className="mt-1 rounded bg-purple-500/10 p-2 italic text-xs text-purple-300 whitespace-pre-wrap">
        {typeof payload.content === "string" ? payload.content : JSON.stringify(payload.content)}
      </div>
    );
  }

  if (event.eventType === "agent_tool_call") {
    return (
      <div className="mt-1 rounded bg-yellow-500/10 p-2 text-xs">
        <span className="font-semibold text-yellow-400">{String(payload.name ?? "unknown")}</span>
        <pre className="mt-1 overflow-x-auto text-muted-foreground">
          {JSON.stringify(payload.args, null, 2)}
        </pre>
      </div>
    );
  }

  if (event.eventType === "agent_tool_result") {
    return (
      <details className="mt-1 rounded bg-green-500/10 p-2 text-xs">
        <summary className="cursor-pointer font-semibold text-green-400">
          {String(payload.name ?? "unknown")} — result
        </summary>
        <pre className="mt-1 overflow-x-auto text-muted-foreground">
          {JSON.stringify(payload.result, null, 2)}
        </pre>
      </details>
    );
  }

  if (payload && Object.keys(payload).length > 0) {
    return (
      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
        {JSON.stringify(payload, null, 2)}
      </pre>
    );
  }

  return null;
}

function AskUserInput({
  taskId,
  question,
  options,
  onSubmitted,
}: {
  taskId: string;
  question: string;
  options?: string[];
  onSubmitted: () => void;
}) {
  const [response, setResponse] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(text: string) {
    setSubmitting(true);
    try {
      await submitTaskInput(taskId, text);
      setResponse("");
      onSubmitted();
    } catch {
      // Error handled silently — user can retry
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-blue-800 bg-blue-950/30 p-4 my-4">
      <p className="text-sm font-medium text-blue-300 mb-2">Agent asks:</p>
      <p className="text-white mb-3">{question}</p>
      {options && options.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => handleSubmit(opt)}
              disabled={submitting}
              className="px-3 py-1.5 text-sm rounded-md border border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Type your response..."
          className="flex-1 px-3 py-2 text-sm rounded-md border border-zinc-600 bg-zinc-900 text-white placeholder:text-zinc-500"
          onKeyDown={(e) => {
            if (e.key === "Enter" && response.trim()) {
              handleSubmit(response.trim());
            }
          }}
        />
        <button
          onClick={() => handleSubmit(response.trim())}
          disabled={submitting || !response.trim()}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

export default function TaskDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const taskData = await getTask(id);
        setTask(taskData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load task");
      } finally {
        setLoading(false);
      }
    }
    load();

    const es = subscribeToTaskEvents(id, (streamEvent) => {
      // streamEvent.data has two shapes coming from server (events.ts):
      //   - Historical backfill: entire TaskEvent {id, taskId, eventType, payload, createdAt}
      //   - Real-time: entire AgentEvent {type, content} or {type, name, args}
      // Normalize: prefer inner .payload (historical shape); fall back to data itself (realtime shape).
      const rawData = streamEvent.data as Record<string, unknown> | undefined;
      const payload =
        rawData && "payload" in rawData && typeof rawData.payload === "object" && rawData.payload !== null
          ? (rawData.payload as Record<string, unknown>)
          : (rawData ?? undefined);
      const taskEvent: TaskEvent = {
        id: Date.now(),
        taskId: id,
        eventType: streamEvent.type as TaskEventType,
        payload,
        createdAt: new Date().toISOString(),
      };
      setEvents((prev) => [...prev, taskEvent]);
    });

    return () => {
      es.close();
    };
  }, [id]);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  useEffect(() => {
    if (events.length === 0) return;
    const lastEvent = events[events.length - 1];
    if (lastEvent && ["completed", "failed", "cancelled", "timed_out"].includes(lastEvent.eventType as string)) {
      getTask(id).then(setTask).catch(() => {});
    }
  }, [events, id]);

  const handleCancel = async () => {
    if (!task || !["pending", "running", "waiting_for_input"].includes(task.status)) return;
    setCancelling(true);
    try {
      const updated = await cancelTask(id);
      setTask(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel task");
    } finally {
      setCancelling(false);
    }
  };

  const handleRetry = async () => {
    if (!task || !["failed", "cancelled", "timed_out"].includes(task.status)) return;
    setRetrying(true);
    try {
      const updated = await retryTask(id);
      setTask(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry task");
    } finally {
      setRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 md:space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !task) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href="/tasks">Back to Tasks</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!task) return null;

  const isAgentEvent = (type: string) => type.startsWith("agent_");

  const isWaitingForInput = task.status === "waiting_for_input";

  // Extract ask_user question/options from events (may arrive via SSE after status is already set)
  const askUserEvent = isWaitingForInput
    ? events
        ?.filter((e: TaskEvent) => e.eventType === "agent_tool_call")
        .findLast((e: TaskEvent) => e.payload?.name === "ask_user")
    : undefined;

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-center gap-2 md:gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/tasks">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">
            Task {task.id.slice(0, 16)}...
          </h1>
          <p className="text-sm text-muted-foreground">{task.id}</p>
        </div>
        <Badge
          variant={
            task.status === "completed"
              ? "secondary"
              : task.status === "failed"
                ? "destructive"
                : "outline"
          }
        >
          {task.status}
        </Badge>
        {["pending", "running", "waiting_for_input"].includes(task.status) && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling..." : "Cancel Task"}
          </Button>
        )}
        {["failed", "cancelled", "timed_out"].includes(task.status) && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            disabled={retrying}
          >
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Retrying..." : "Retry"}
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-4 md:gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Queue</span>
              <span className="font-mono text-sm">{task.queue}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Model</span>
              <span className="font-mono text-sm">{task.model}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Priority</span>
              <span className="text-sm">{task.priority}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Strategy</span>
              <span className="text-sm">{task.routingStrategy}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Max Retries</span>
              <span className="text-sm">{task.retryCount}/{task.maxRetries}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Timeout</span>
              <span className="text-sm">{task.timeout}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm">
                {new Date(task.createdAt).toLocaleString()}
              </span>
            </div>
            {task.startedAt && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Started</span>
                <span className="text-sm">
                  {new Date(task.startedAt).toLocaleString()}
                </span>
              </div>
            )}
            {task.completedAt && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Completed</span>
                <span className="text-sm">
                  {new Date(task.completedAt).toLocaleString()}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage & Cost</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {task.tokenUsage ? (
              <>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Input Tokens</span>
                  <span className="font-mono text-sm">{task.tokenUsage.inputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Output Tokens</span>
                  <span className="font-mono text-sm">{task.tokenUsage.outputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total Tokens</span>
                  <span className="font-mono text-sm">{(task.tokenUsage.inputTokens + task.tokenUsage.outputTokens).toLocaleString()}</span>
                </div>
                <div className="border-t pt-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Cost</span>
                    <span className="font-mono text-sm font-semibold">${task.costUsd?.toFixed(6) ?? "0.000000"}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Not yet available</p>
            )}
            {task.error && (
              <div className="border-t pt-3">
                <span className="text-sm text-muted-foreground">Error</span>
                <p className="mt-1 rounded bg-destructive/10 p-2 font-mono text-xs text-destructive">{task.error}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded bg-muted p-4 text-sm">
            {task.systemPrompt && (
              <>
                <span className="font-semibold text-muted-foreground">System:</span> {task.systemPrompt}
                {"\n\n"}
              </>
            )}
            {task.prompt}
          </pre>
        </CardContent>
      </Card>

      {task.result && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded bg-muted p-4 text-sm">{task.result}</pre>
          </CardContent>
        </Card>
      )}

      {isWaitingForInput && (
        <AskUserInput
          taskId={task.id}
          question={(askUserEvent?.payload?.args as Record<string, unknown> | undefined)?.question as string ?? "Waiting for your input..."}
          options={(askUserEvent?.payload?.args as Record<string, string[]> | undefined)?.options}
          onSubmitted={() => {
            window.location.reload();
          }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Waiting for events...</p>
          ) : (
            <div className="space-y-0 max-h-[600px] overflow-y-auto">
              {groupEventsIntoTurns(events).map((turn, turnIdx) => {
                const isAgentTurn = turn.length > 0 && turn[0]!.eventType.startsWith("agent_");
                return (
                  <div key={`turn-${turnIdx}`} className={isAgentTurn ? "mb-3 rounded-lg border border-border/50 bg-muted/30 p-3" : "mb-2"}>
                    {isAgentTurn && (
                      <p className="mb-2 text-xs font-semibold text-muted-foreground">Turn {turnIdx + 1}</p>
                    )}
                    {turn.map((event, idx) => (
                      <div key={`${event.id}-${idx}`} className="flex gap-4 pb-2">
                        <div className="flex flex-col items-center">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                            {eventIcons[event.eventType] ?? <Clock className="h-3 w-3" />}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium ${isAgentEvent(event.eventType) ? "font-mono" : ""} ${event.eventType === "agent_text" ? "text-blue-300" : event.eventType === "agent_thinking" ? "text-purple-300" : ""}`}>
                              {isAgentEvent(event.eventType)
                                ? (event.payload?.content as string)?.slice(0, 80) ?? event.eventType.replace("agent_", "")
                                : event.eventType.replace(/_/g, " ")}
                            </p>
                            <p className="text-xs text-muted-foreground shrink-0">
                              {new Date(event.createdAt).toLocaleTimeString()}
                            </p>
                          </div>
                          <AgentEventContent event={event} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div ref={eventsEndRef} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
